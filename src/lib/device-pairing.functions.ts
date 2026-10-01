import { createHash, randomBytes } from "crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseCohort, type AgeCohort } from "@/lib/child-policy";
import {
  isManagedUser,
  isMissingRelationError,
  managedChildErrorMessage,
} from "@/lib/managed-children";
import { PAIRING_CODE_LENGTH } from "@/lib/device-pairing";

/**
 * Server side of device pairing — see src/lib/device-pairing.ts for what this
 * is and why there is at most one active pairing per child, and the migration
 * (supabase/migrations/20261001120000_managed_device_pairing.sql) for the
 * database functions these call.
 *
 * The service role is used for: clearing/setting the ban that stands in for
 * "every session this child has, revoked" (see revokeDevicePairing — nothing
 * in Supabase's Admin API can end a single session by itself), and the one
 * genuinely unauthenticated call in this app, lookupDevicePairing — the
 * device redeeming a code has no session yet to attach one to.
 */

type Ctx = {
  supabase: SupabaseClient<Database>;
  userId: string;
  claims: { app_metadata?: Record<string, unknown> };
};

/** A device pairing's own session may not create another one. */
function refuseManagedCaller(context: Ctx) {
  if (isManagedUser({ app_metadata: context.claims?.app_metadata ?? {} })) {
    throw new Error(managedChildErrorMessage("MANAGED_SESSION_NOT_ALLOWED"));
  }
}

/** Same two-step lookup startManagedSession uses: profiles first, my_platform_status() as a fallback. */
async function callerCohort(context: Ctx): Promise<AgeCohort> {
  const { data: me } = await context.supabase
    .from("profiles")
    .select("age_cohort")
    .eq("id", context.userId)
    .maybeSingle();
  let cohort = parseCohort((me as { age_cohort?: string } | null)?.age_cohort);
  if (cohort !== "adult") {
    const { data: status } = await context.supabase.rpc("my_platform_status");
    const row = (Array.isArray(status) ? status[0] : status) as Record<string, unknown> | null;
    cohort = parseCohort(row?.["cohort"]);
  }
  return cohort;
}

const PAIRING_TTL_MINUTES = 10;
const HASH_PREFIX = "openrun-device-pairing:";

/** SHA-256, domain-separated the same way family-invites.functions.ts hashes its own tokens. */
function hashPairingCode(code: string): string {
  return createHash("sha256").update(`${HASH_PREFIX}${code}`).digest("hex");
}

/** Crockford base32 (no I, L, O, U — nothing a person could misread or mistype). */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ~50 bits of entropy: the only defense on lookupDevicePairing, which has no caller to rate-limit by. */
function generatePairingCode(): string {
  const bytes = randomBytes(Math.ceil((PAIRING_CODE_LENGTH * 5) / 8));
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  const totalBits = BigInt(bytes.length * 8);
  let out = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    const shift = totalBits - BigInt(i + 1) * 5n;
    out += CODE_ALPHABET[Number((bits >> shift) & 0x1fn)];
  }
  return out;
}

function isMissingDevicePairingSchema(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return error?.code === "PGRST202" || error?.code === "42883" || isMissingRelationError(error);
}

/**
 * Let the managing guardian pair one of their managed child's own devices.
 *
 * Returns the plain pairing code exactly once — only its hash is stored — for
 * the guardian to show (or hand to) the child's device. Creating a new
 * pairing supersedes any existing one for that child: see src/lib/device-pairing.ts
 * for why there is only ever one.
 */
export const createDevicePairing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string; deviceLabel?: string }) =>
    z
      .object({
        childUserId: z.string().uuid(),
        deviceLabel: z.string().trim().max(40).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<{ code: string; expiresAt: string }> => {
    const ctx: Ctx = context;
    refuseManagedCaller(ctx);
    if ((await callerCohort(ctx)) !== "adult") {
      throw new Error(managedChildErrorMessage("ADULT_REQUIRED"));
    }

    const { data: managed } = await ctx.supabase
      .from("managed_accounts")
      .select("child_user_id")
      .eq("child_user_id", data.childUserId)
      .eq("managed_by", ctx.userId)
      .maybeSingle();
    if (!managed) throw new Error(managedChildErrorMessage("NOT_MANAGED"));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // A revoked child is banned (see revokeDevicePairing). Pairing a fresh
    // device is a guardian action just as legitimate as switching into the
    // child's profile, so it lifts a stale ban the same way startManagedSession
    // does — best-effort, nothing below depends on this succeeding.
    await supabaseAdmin.auth.admin
      .updateUserById(data.childUserId, { ban_duration: "none" })
      .catch(() => undefined);

    let code: string | undefined;
    let id: string | undefined;
    // A code_hash collision is astronomically unlikely at ~50 bits; this
    // loop exists so the one-in-a-trillion case is a retry, not a 500.
    for (let attempt = 0; attempt < 5 && !id; attempt++) {
      const candidate = generatePairingCode();
      const { data: newId, error } = await ctx.supabase.rpc("create_device_pairing", {
        _child_user_id: data.childUserId,
        _code_hash: hashPairingCode(candidate),
        _device_label: data.deviceLabel || undefined,
        _ttl_minutes: PAIRING_TTL_MINUTES,
      });
      if (!error) {
        code = candidate;
        id = newId as string;
        break;
      }
      if (isMissingDevicePairingSchema(error)) {
        throw new Error(managedChildErrorMessage("PAIRING_UNAVAILABLE"));
      }
      if (!/duplicate key|unique constraint/i.test(error.message)) {
        throw new Error(managedChildErrorMessage(error.message));
      }
    }
    if (!id || !code) throw new Error(managedChildErrorMessage("PAIRING_UNAVAILABLE"));

    return { code, expiresAt: new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000).toISOString() };
  });

/**
 * What the child's device sees before it has any session at all. No
 * middleware — the one genuinely unauthenticated server fn in this app, used
 * only via the service-role client below, never an anon-key one (the database
 * grants nothing on lookup_device_pairing() to anon either — see the
 * migration). Read-only: it never marks the code used, so a flaky retry can't
 * burn it. Only confirmDevicePairing, called once the device actually has a
 * session, does that.
 */
export const lookupDevicePairing = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string }) =>
    z.object({ code: z.string().trim().length(PAIRING_CODE_LENGTH) }).parse(d),
  )
  .handler(async ({ data }): Promise<{ tokenHash: string; childFirstName: string | null }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin.rpc("lookup_device_pairing", {
      _code_hash: hashPairingCode(data.code),
    });
    if (error) {
      if (isMissingDevicePairingSchema(error)) {
        throw new Error(managedChildErrorMessage("PAIRING_UNAVAILABLE"));
      }
      console.error("[device-pairing] lookup failed", error.message);
      throw new Error(managedChildErrorMessage(null));
    }
    const row = (Array.isArray(rows) ? rows[0] : rows) as
      { child_user_id: string | null; state: string } | undefined;
    const state = row?.state ?? "invalid";
    if (state !== "linked") {
      const code =
        state === "expired"
          ? "PAIRING_EXPIRED"
          : state === "used"
            ? "PAIRING_USED"
            : state === "revoked"
              ? "PAIRING_REVOKED"
              : "PAIRING_INVALID";
      throw new Error(managedChildErrorMessage(code));
    }
    const childUserId = row?.child_user_id;
    if (!childUserId) throw new Error(managedChildErrorMessage("PAIRING_INVALID"));

    // Revalidate directly against the auth user, the same defensive check
    // startManagedSession makes before minting a link — the row says
    // "linked", but the child's account is the thing that actually matters.
    const { data: child } = await supabaseAdmin.auth.admin.getUserById(childUserId);
    const user = child?.user;
    if (!user?.email || !isManagedUser(user)) {
      throw new Error(managedChildErrorMessage("PAIRING_INVALID"));
    }

    const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      console.error("[device-pairing] generateLink failed", linkError?.message);
      throw new Error(managedChildErrorMessage(null));
    }

    const displayName =
      typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : null;
    return { tokenHash, childFirstName: displayName ? displayName.split(" ")[0] : null };
  });

/**
 * Called by the child's own device, once it actually has a session —
 * bookkeeping only ("paired since …" in the Parent Center), never load-bearing
 * for access: the session exists either way by the time this runs. Never
 * throws, so a redeeming device's one `await` here can be fire-and-forget.
 */
export const confirmDevicePairing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ confirmed: boolean }> => {
    const ctx: Ctx = context;
    if (!isManagedUser({ app_metadata: ctx.claims?.app_metadata ?? {} })) {
      // Not a managed-child session at all — nothing to confirm.
      return { confirmed: false };
    }
    const { data, error } = await ctx.supabase.rpc("confirm_device_pairing");
    if (error) {
      console.error("[device-pairing] confirm failed", error.message);
      return { confirmed: false };
    }
    return { confirmed: data === true };
  });

/**
 * End a managed child's device pairing. Supabase's Admin API has no way to
 * revoke one session by itself (no listSessions; signOut needs a JWT this
 * server never holds — the child's tokens are minted for the browser and
 * never pass through here, same as startManagedSession). Banning the child's
 * auth user is the only lever that doesn't need one: it blocks every future
 * sign-in and refresh, so "revoke" ends every session this child currently
 * has within that session's own short access-token lifetime — the act-as
 * swap included, if one happened to be live. createDevicePairing lifts the
 * ban again the next time the guardian pairs a device.
 */
export const revokeDevicePairing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string }) =>
    z.object({ childUserId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const ctx: Ctx = context;
    refuseManagedCaller(ctx);

    const { error } = await ctx.supabase.rpc("revoke_device_pairing", {
      _child_user_id: data.childUserId,
    });
    if (error) throw new Error(managedChildErrorMessage(error.message));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.auth.admin
      .updateUserById(data.childUserId, { ban_duration: "876000h" })
      .catch((e) => console.error("[device-pairing] ban failed", e));

    return { ok: true };
  });

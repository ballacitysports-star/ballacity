import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  checkChildUsername,
  cohortFromBirthday,
  isMinorCohort,
  parseCohort,
  type AgeCohort,
} from "@/lib/child-policy";
import { effectiveVersion, type PublishedLegalDocument } from "@/lib/legal-documents";
import {
  GUARDIAN_RELATIONSHIPS,
  childDisplayName,
  isManagedUser,
  isMissingRelationError,
  managedByOf,
  managedChildErrorMessage,
  managedEmailFor,
} from "@/lib/managed-children";
import {
  MAX_PAIR_LINKS_PER_HOUR,
  generatePairToken,
  hashPairToken,
  isPairToken,
  pairLinkExpiry,
} from "@/lib/managed-pairing";

/**
 * Server side of managed children — minors a guardian adds without giving
 * them an email or password.
 *
 * The service role is used for exactly two things: creating the child's auth
 * user (only the Admin API can make an account with no credentials and set
 * tamper-proof app_metadata), and deleting it again. Everything else runs with
 * the guardian's own token, so `provision_managed_child()` sees the guardian
 * as auth.uid(), enforces the adult check in the database, and every audit,
 * consent and age-change row names the guardian.
 */

type Ctx = {
  supabase: SupabaseClient<Database>;
  userId: string;
  claims: { app_metadata?: Record<string, unknown> };
};

const MAX_MANAGED = 10;
const MAX_MANAGED_PER_DAY = 5;

/** A managed child's session may not create, delete or manage other accounts. */
function refuseManagedCaller(context: Ctx) {
  if (isManagedUser({ app_metadata: context.claims?.app_metadata ?? {} })) {
    throw new Error(managedChildErrorMessage("MANAGED_SESSION_NOT_ALLOWED"));
  }
}

/**
 * The caller's authoritative cohort. profiles.age_cohort can lag behind the
 * private birthday table, so fall back to my_platform_status() as
 * approveConsentAsGuardian does.
 */
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

/** The Terms and Privacy versions a member is shown right now — the ones the guardian accepts. */
async function currentLegalVersions(context: Ctx): Promise<{ terms: string; privacy: string }> {
  const { data } = await context.supabase
    .from("legal_documents")
    .select(
      "id, document_type, title, version, content, summary, requires_reacceptance, effective_date, published, published_at, archived_at",
    )
    .not("published_at", "is", null)
    .order("effective_date", { ascending: false });
  const published = (data ?? []) as PublishedLegalDocument[];
  return {
    terms: effectiveVersion("terms", published).version,
    privacy: effectiveVersion("privacy", published).version,
  };
}

export type CreatedManagedChild = {
  childUserId: string;
  displayName: string;
  cohort: AgeCohort;
  consentRecorded: boolean;
};

export const createManagedChild = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      firstName: string;
      lastName?: string;
      dateOfBirth: string;
      sport?: string;
      relationship: string;
      attested: true;
      fromPlayerProfileId?: string;
    }) =>
      z
        .object({
          firstName: z.string().trim().min(1).max(60),
          lastName: z.string().trim().max(60).optional(),
          dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          sport: z.string().trim().max(40).optional(),
          relationship: z.enum(GUARDIAN_RELATIONSHIPS),
          attested: z.literal(true),
          fromPlayerProfileId: z.string().uuid().optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }): Promise<CreatedManagedChild> => {
    const ctx: Ctx = context;
    refuseManagedCaller(ctx);

    // Cheap checks first, so a bad form never creates (and then deletes) an
    // auth user. The database repeats every one of them.
    const name = childDisplayName(data.firstName, data.lastName);
    if (!name.ok) throw new Error(name.message);
    const cohort = cohortFromBirthday(data.dateOfBirth);
    if (cohort === "unknown") throw new Error(managedChildErrorMessage("DOB_INVALID"));
    if (!isMinorCohort(cohort)) throw new Error(managedChildErrorMessage("CHILD_IS_ADULT"));
    const safe = checkChildUsername(name.displayName, { cohort });
    if (!safe.ok) throw new Error(managedChildErrorMessage("MINOR_HANDLE_UNSAFE"));

    if ((await callerCohort(ctx)) !== "adult") {
      throw new Error(managedChildErrorMessage("ADULT_REQUIRED"));
    }

    const { data: mine, error: mineError } = await ctx.supabase
      .from("managed_accounts")
      .select("created_at")
      .eq("managed_by", ctx.userId);
    // The migration hasn't been applied to this backend yet: say so now rather
    // than creating an account only to delete it again when provisioning fails.
    if (isMissingRelationError(mineError)) {
      throw new Error(managedChildErrorMessage("MANAGED_UNAVAILABLE"));
    }
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const rows = (mine ?? []) as { created_at: string }[];
    if (
      rows.length >= MAX_MANAGED ||
      rows.filter((r) => new Date(r.created_at).getTime() > dayAgo).length >= MAX_MANAGED_PER_DAY
    ) {
      throw new Error(managedChildErrorMessage("MANAGED_LIMIT"));
    }

    const versions = await currentLegalVersions(ctx);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const random = globalThis.crypto.randomUUID().replace(/-/g, "");
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: managedEmailFor(random),
      email_confirm: true,
      // "Player" keeps handle_new_user from deriving a name from the
      // placeholder address; the real name is set once the cohort is known.
      user_metadata: { display_name: "Player", account_type: "player" },
      app_metadata: { managed: true, managed_by: ctx.userId },
    });
    if (createError || !created?.user) {
      console.error("[managed-children] createUser failed", createError?.message);
      throw new Error(managedChildErrorMessage(null));
    }
    const childUserId = created.user.id;

    const { data: provisioned, error: provisionError } = await ctx.supabase.rpc(
      "provision_managed_child",
      {
        _child: childUserId,
        _dob: data.dateOfBirth,
        _display_name: name.displayName,
        _relationship: data.relationship,
        _sport: data.sport || undefined,
        _versions: versions,
        _attested: true,
      },
    );
    if (provisionError) {
      // Nothing half-made may survive: the transaction already rolled back
      // the rows, so only the auth user is left to remove.
      await supabaseAdmin.auth.admin.deleteUser(childUserId).catch(() => undefined);
      throw new Error(managedChildErrorMessage(provisionError.message));
    }
    const row = (Array.isArray(provisioned) ? provisioned[0] : provisioned) as
      { cohort: string; consent_recorded: boolean } | undefined;

    // The auth record still carries the "Player" placeholder; give it the real
    // name so anything reading the session's metadata agrees with the profile.
    // No migration puts an UPDATE trigger on auth.users (handle_new_user is
    // AFTER INSERT), so this touches nothing else. Best-effort: the profile
    // row is the source of truth.
    await supabaseAdmin.auth.admin
      .updateUserById(childUserId, {
        user_metadata: { display_name: name.displayName, account_type: "player" },
      })
      .catch(() => undefined);

    // A child the parent started on the old Add Player screen: the leftover
    // login-less row is replaced by the real profile, so remove it. RLS limits
    // the delete to the caller's own rows.
    if (data.fromPlayerProfileId) {
      await ctx.supabase
        .from("player_profiles")
        .delete()
        .eq("id", data.fromPlayerProfileId)
        .eq("account_id", ctx.userId)
        .is("user_id", null);
    }

    return {
      childUserId,
      displayName: name.displayName,
      cohort: parseCohort(row?.cohort ?? cohort),
      consentRecorded: row?.consent_recorded === true,
    };
  });

/**
 * Permanently delete a child profile this guardian manages.
 *
 * Only the managing guardian may do it. The child has no login of their own,
 * so this is the only way their data can ever be erased — which is also why
 * ending the family link is refused for them.
 */
export const deleteManagedChild = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string }) =>
    z.object({ childUserId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const ctx: Ctx = context;
    refuseManagedCaller(ctx);

    const { data: managed } = await ctx.supabase
      .from("managed_accounts")
      .select("child_user_id")
      .eq("child_user_id", data.childUserId)
      .eq("managed_by", ctx.userId)
      .maybeSingle();
    if (!managed) throw new Error(managedChildErrorMessage("NOT_AUTHORIZED"));

    const [{ supabaseAdmin }, { purgeUserAccount }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/account-purge.server"),
    ]);
    // Append-only and keyed without a foreign key, so it outlives the child.
    await supabaseAdmin.from("family_audit_log").insert({
      actor_user_id: ctx.userId,
      child_user_id: data.childUserId,
      action: "managed.deleted",
      context: {},
    } as never);
    await purgeUserAccount(data.childUserId);
    return { ok: true };
  });

/**
 * Let the managing guardian act as their managed child.
 *
 * Returns only the one-time hashed token of a magic link: the browser redeems
 * it with `verifyOtp`, so the child's session tokens are minted for the
 * browser and never pass through this server. No email is involved —
 * `generateLink` returns the link instead of sending it, and the auth-email
 * hook ignores the child's placeholder address in any case.
 *
 * Only for a managed child (no credentials) and only for the guardian who
 * manages them. A child with their own login is never switchable: that login
 * is theirs.
 */
export const startManagedSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string }) =>
    z.object({ childUserId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }): Promise<{ tokenHash: string }> => {
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
    const { data: child } = await supabaseAdmin.auth.admin.getUserById(data.childUserId);
    const user = child?.user;
    if (!user?.email || !isManagedUser(user) || managedByOf(user) !== ctx.userId) {
      throw new Error(managedChildErrorMessage("NOT_MANAGED"));
    }

    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (error || !tokenHash) {
      console.error("[managed-children] generateLink failed", error?.message);
      throw new Error(managedChildErrorMessage(null));
    }

    await supabaseAdmin.from("family_audit_log").insert({
      actor_user_id: ctx.userId,
      child_user_id: data.childUserId,
      action: "managed.session_started",
      context: {},
    } as never);

    return { tokenHash };
  });

/**
 * The caller must be an adult, not a managed child, and the managing guardian
 * of `childUserId`, who must still be a credential-less managed child. Returns
 * the child's placeholder address (what a sign-in link is generated for).
 */
async function assertManagingGuardian(ctx: Ctx, childUserId: string): Promise<string> {
  refuseManagedCaller(ctx);
  if ((await callerCohort(ctx)) !== "adult") {
    throw new Error(managedChildErrorMessage("ADULT_REQUIRED"));
  }
  const { data: managed } = await ctx.supabase
    .from("managed_accounts")
    .select("child_user_id")
    .eq("child_user_id", childUserId)
    .eq("managed_by", ctx.userId)
    .maybeSingle();
  if (!managed) throw new Error(managedChildErrorMessage("NOT_MANAGED"));
  return childEmailManagedBy(childUserId, ctx.userId);
}

/** The child's address, only if they are a managed child managed by `guardianId`. */
async function childEmailManagedBy(childUserId: string, guardianId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: child } = await supabaseAdmin.auth.admin.getUserById(childUserId);
  const user = child?.user;
  if (!user?.email || !isManagedUser(user) || managedByOf(user) !== guardianId) {
    throw new Error(managedChildErrorMessage("NOT_MANAGED"));
  }
  return user.email;
}

/**
 * `managed_pair_links` is not in the generated types until they are next
 * regenerated, and only ever touched here with the service role.
 */
async function pairLinksTable() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as SupabaseClient;
  return { admin, links: admin.from("managed_pair_links") };
}

async function auditFamily(
  actorUserId: string,
  childUserId: string,
  action: string,
  context: Record<string, unknown> = {},
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("family_audit_log").insert({
    actor_user_id: actorUserId,
    child_user_id: childUserId,
    action,
    context,
  } as never);
}

/**
 * Make a one-time link the managing guardian can give to their child's phone.
 *
 * Only a hash of the token is stored. A new link cancels any earlier one that
 * hasn't been used, so there is only ever one live link per child.
 */
export const createPairingLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string }) =>
    z.object({ childUserId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }): Promise<{ token: string; expiresAt: string }> => {
    const ctx: Ctx = context;
    await assertManagingGuardian(ctx, data.childUserId);

    const { links } = await pairLinksTable();
    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count } = await links
      .select("id", { count: "exact", head: true })
      .eq("child_user_id", data.childUserId)
      .gte("created_at", hourAgo);
    if ((count ?? 0) >= MAX_PAIR_LINKS_PER_HOUR) {
      throw new Error(managedChildErrorMessage("PAIR_RATE_LIMITED"));
    }

    const now = new Date().toISOString();
    await links
      .update({ revoked_at: now })
      .eq("child_user_id", data.childUserId)
      .is("used_at", null)
      .is("revoked_at", null);

    const token = generatePairToken();
    const expiresAt = pairLinkExpiry().toISOString();
    const { error } = await links.insert({
      child_user_id: data.childUserId,
      created_by: ctx.userId,
      token_hash: await hashPairToken(token),
      expires_at: expiresAt,
    });
    if (error) {
      console.error("[managed-children] pair link insert failed", error.message);
      throw new Error(managedChildErrorMessage(null));
    }

    await auditFamily(ctx.userId, data.childUserId, "managed.pair_link_created");
    return { token, expiresAt };
  });

/**
 * Redeem a pairing link from the child's phone. There is no signed-in caller:
 * the unguessable, single-use token is the credential.
 *
 * The link is spent before anything else happens, in one conditional update, so
 * two taps can't both win. Every failure answers the same way, so nobody can
 * tell an unknown link from an expired, used or revoked one. Like
 * `startManagedSession`, this returns only a one-time token hash for the
 * browser to redeem with `verifyOtp`; the child's session tokens never pass
 * through this server.
 */
export const redeemPairingLink = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) =>
    z.object({ token: z.string().refine(isPairToken) }).parse(d),
  )
  .handler(async ({ data }): Promise<{ tokenHash: string }> => {
    const invalid = () => new Error(managedChildErrorMessage("PAIR_LINK_INVALID"));

    const { admin, links } = await pairLinksTable();
    const { data: spent } = await links
      .update({ used_at: new Date().toISOString() })
      .eq("token_hash", await hashPairToken(data.token))
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("child_user_id, created_by")
      .maybeSingle();
    if (!spent) throw invalid();
    const { child_user_id: childUserId, created_by: guardianId } = spent as {
      child_user_id: string;
      created_by: string;
    };

    // The guardian must still manage this child, as when the link was made.
    const { data: managed } = await admin
      .from("managed_accounts")
      .select("child_user_id")
      .eq("child_user_id", childUserId)
      .eq("managed_by", guardianId)
      .maybeSingle();
    if (!managed) throw invalid();

    let email: string;
    try {
      email = await childEmailManagedBy(childUserId, guardianId);
    } catch {
      throw invalid();
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (error || !tokenHash) {
      console.error("[managed-children] pair generateLink failed", error?.message);
      throw new Error(managedChildErrorMessage(null));
    }

    await auditFamily(guardianId, childUserId, "managed.device_paired", { via: "pair_link" });
    return { tokenHash };
  });

/**
 * Sign the child out everywhere: every session and refresh token is deleted,
 * and any link that hasn't been used is cancelled. A phone that was already
 * signed in is logged out the next time it refreshes — an access token already
 * issued keeps working until it expires (about an hour).
 */
export const revokeChildDevices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string }) =>
    z.object({ childUserId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const ctx: Ctx = context;
    await assertManagingGuardian(ctx, data.childUserId);

    const { links } = await pairLinksTable();
    await links
      .update({ revoked_at: new Date().toISOString() })
      .eq("child_user_id", data.childUserId)
      .is("used_at", null)
      .is("revoked_at", null);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("admin_revoke_user_sessions", {
      _user_id: data.childUserId,
    });
    if (error) {
      console.error("[managed-children] revoke sessions failed", error.message);
      throw new Error(managedChildErrorMessage(null));
    }

    await auditFamily(ctx.userId, data.childUserId, "managed.devices_revoked");
    return { ok: true };
  });

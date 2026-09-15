import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Parent-first family invitations.
 *
 * An adult creates an invitation for a minor they are responsible for. The
 * plain code is returned exactly once so it can be handed to the child — only
 * its hash is stored, and the database enforces single use, expiry, adult-only
 * creation and per-parent caps. Redeeming links the guardian and, for under-13
 * members, records approved parental consent plus default safety controls.
 */

const INVITE_TTL_DAYS = 14;

function hashToken(token: string): string {
  return createHash("sha256").update(`openrun-minor-invite:${token}`).digest("hex");
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export type MinorInvite = {
  id: string;
  childName: string;
  relationship: string;
  status: "pending" | "redeemed" | "revoked" | "expired";
  expiresAt: string;
  redeemedAt: string | null;
  childUserId: string | null;
  createdAt: string;
};

export type MinorInviteLookup = {
  state: "pending" | "expired" | "revoked" | "redeemed" | "invalid";
  childName: string | null;
  relationship: string | null;
  parentName: string | null;
  expiresAt: string | null;
};

/** Create an invitation. The returned link/code is shown once. */
export const createMinorInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childName: string; relationship?: string }) =>
    z
      .object({
        childName: z.string().trim().min(1).max(60),
        relationship: z.string().trim().max(40).optional(),
      })
      .parse(d),
  )
  .handler(
    async ({ data, context }): Promise<{ token: string; path: string; expiresAt: string }> => {
      const token = newToken();
      const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
      const { error } = await context.supabase.rpc("create_minor_invite", {
        _child_name: data.childName,
        _relationship: data.relationship ?? "parent",
        _token_hash: hashToken(token),
        _expires_at: expiresAt,
      });
      if (error) throw new Error(friendly(error.message));
      return { token, path: `/family/join/${token}`, expiresAt };
    },
  );

/** Every invitation this parent created. */
export const listMyMinorInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MinorInvite[]> => {
    const { data, error } = await context.supabase
      .from("minor_invites")
      .select(
        "id, child_name, relationship, status, expires_at, redeemed_at, child_user_id, created_at",
      )
      .eq("parent_user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error("Could not load your family invitations.");
    const now = Date.now();
    return (data ?? []).map((r) => {
      const expired = r.status === "pending" && new Date(r.expires_at).getTime() < now;
      return {
        id: r.id,
        childName: r.child_name,
        relationship: r.relationship,
        status: expired ? "expired" : (r.status as MinorInvite["status"]),
        expiresAt: r.expires_at,
        redeemedAt: r.redeemed_at,
        childUserId: r.child_user_id,
        createdAt: r.created_at,
      };
    });
  });

export const revokeMinorInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("revoke_minor_invite", { _id: data.id });
    if (error) throw new Error(friendly(error.message));
    return { ok: true };
  });

/** What the invited member sees before accepting. */
export const lookupMinorInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { token: string }) =>
    z.object({ token: z.string().trim().min(16).max(128) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<MinorInviteLookup> => {
    const { data: rows, error } = await context.supabase.rpc("lookup_minor_invite", {
      _token_hash: hashToken(data.token),
    });
    if (error) throw new Error(friendly(error.message));
    const row = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | null;
    const state = String(row?.["state"] ?? "invalid") as MinorInviteLookup["state"];
    return {
      state,
      childName: (row?.["child_name"] as string | null) ?? null,
      relationship: (row?.["relationship"] as string | null) ?? null,
      parentName: (row?.["parent_name"] as string | null) ?? null,
      expiresAt: (row?.["expires_at"] as string | null) ?? null,
    };
  });

/** Accept the invitation as the invited member. Single use. */
export const redeemMinorInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { token: string }) =>
    z.object({ token: z.string().trim().min(16).max(128) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ consentRecorded: boolean }> => {
    const { data: rows, error } = await context.supabase.rpc("redeem_minor_invite", {
      _token_hash: hashToken(data.token),
    });
    if (error) throw new Error(friendly(error.message));
    const row = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | null;
    return { consentRecorded: row?.["consent_recorded"] === true };
  });

function friendly(message: string): string {
  const m = message ?? "";
  if (m.includes("ADULT_REQUIRED")) return "Only an adult account can add a minor.";
  if (m.includes("TOO_MANY_INVITES"))
    return "You have too many open invitations. Cancel one first.";
  if (m.includes("NAME_REQUIRED")) return "Add the child's first name.";
  if (m.includes("INVITE_EXPIRED")) return "That invitation has expired. Ask for a new link.";
  if (m.includes("INVITE_REVOKED")) return "That invitation was cancelled.";
  if (m.includes("INVITE_USED")) return "That invitation was already used.";
  if (m.includes("INVITE_SELF")) return "You cannot accept your own invitation.";
  if (m.includes("INVITE_INVALID")) return "That invitation link is not valid.";
  if (m.includes("ALREADY_LINKED")) return "You are already connected to this parent or guardian.";
  if (m.includes("AGE_VERIFICATION_REQUIRED"))
    return "Add your date of birth first, then open the invitation again.";
  if (m.includes("AUTH_REQUIRED")) return "Sign in first.";
  if (m.includes("NOT_FOUND")) return "That invitation is no longer open.";
  return "Something went wrong. Please try again.";
}

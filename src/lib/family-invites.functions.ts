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
 * creation and per-parent caps. Redeeming never links anyone on its own
 * (SEC-4): it creates a pending request. A child with no guardian waits for
 * BallaCity staff to verify the adult; a child who already has one waits for
 * that guardian to approve. Consent and controls apply once it is approved.
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
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      consentRecorded: boolean;
      pendingApproval: boolean;
      verificationRequired: boolean;
      parentId: string | null;
    }> => {
      const { data: rows, error } = await context.supabase.rpc("redeem_minor_invite", {
        _token_hash: hashToken(data.token),
      });
      if (error) throw new Error(friendly(error.message));
      const row = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | null;
      // pendingApproval: nothing is linked yet. verificationRequired: BallaCity verifies this first
      // guardian; otherwise the player's current guardian approves the new one.
      return {
        consentRecorded: row?.["consent_recorded"] === true,
        pendingApproval: row?.["pending_approval"] === true,
        verificationRequired: row?.["verification_required"] === true,
        parentId: (row?.["parent_id"] as string | null) ?? null,
      };
    },
  );

/** The invited player cancels their own pending request (for a link they did not expect). */
export const withdrawMyGuardianClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { parentId: string }) => z.object({ parentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    // Row security returns only requests this player is a party to.
    const { data: rows, error } = await context.supabase
      .from("guardian_link_requests" as never)
      .select("id")
      .eq("child_user_id", context.userId)
      .eq("parent_user_id", data.parentId)
      .eq("status", "pending")
      .limit(1);
    if (error) throw new Error("Could not cancel that request.");
    const id = ((rows ?? []) as unknown as { id: string }[])[0]?.id;
    if (!id) throw new Error("That request is no longer waiting.");
    const { error: wErr } = await context.supabase.rpc(
      "withdraw_guardian_claim" as never,
      { _request: id } as never,
    );
    if (wErr) throw new Error("Could not cancel that request.");
    return { ok: true };
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
  if (m.includes("ALREADY_REQUESTED"))
    return "This connection is already waiting for your parent or guardian to approve it.";
  if (m.includes("ADULT_CANNOT_REDEEM")) return "Family invitations are for players under 18.";
  if (m.includes("CLAIM_RATE_LIMITED"))
    return "This invitation can't be used right now. Try again later or contact support.";
  if (m.includes("AGE_VERIFICATION_REQUIRED"))
    return "Add your date of birth first, then open the invitation again.";
  if (m.includes("AUTH_REQUIRED")) return "Sign in first.";
  if (m.includes("NOT_FOUND")) return "That invitation is no longer open.";
  return "Something went wrong. Please try again.";
}

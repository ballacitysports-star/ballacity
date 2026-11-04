/**
 * Server-only helpers shared by the moderator surfaces.
 * Never import this from client code — it is loaded inside server-fn handlers.
 */

import {
  EVIDENCE_COLUMNS,
  latestOpenEvidenceByGame,
  type EvidenceRow,
  type HeldEvidence,
} from "@/lib/location-hold";

export type ModeratorCtx = { supabase: any; userId: string };

/** Moderator = admin, moderator, or superadmin role. */
export async function assertModerator(ctx: ModeratorCtx) {
  const { data, error } = await ctx.supabase.rpc("is_moderator", {
    _user_id: ctx.userId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

/**
 * The held listing text of each game (the latest open automatic hold), for the moderation screen only. Checks the role first and
 * reads with the caller's own session, so the table's row security (moderators and administrators) applies as a second check: a host
 * or a reporter gets nothing even if this were ever called for them.
 */
export async function loadHeldEvidence(
  ctx: ModeratorCtx,
  gameIds: string[],
): Promise<Map<string, HeldEvidence>> {
  await assertModerator(ctx);
  if (gameIds.length === 0) return new Map();
  const { data, error } = await ctx.supabase
    .from("location_report_evidence")
    .select(EVIDENCE_COLUMNS)
    .in("game_id", gameIds)
    .is("released_at", null)
    .is("captured_by", null)
    .order("captured_at", { ascending: false });
  if (error) throw new Error(error.message);
  return latestOpenEvidenceByGame((data ?? []) as EvidenceRow[]);
}

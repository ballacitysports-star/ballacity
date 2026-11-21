/**
 * For a game's host: which of its join requests come from a minor who has an
 * active guardian, and whether that guardian has approved. Booleans only; no
 * guardian identity leaves the server. Only the game's host may ask.
 */
import { guardianLinksInForce } from "./guardian-links-in-force.server";

type Admin = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type GuardianNeed = { requestId: string; needsGuardian: boolean; guardianApproved: boolean };

export async function guardianNeedsForGame(
  admin: Admin,
  input: { gameId: string; callerId: string },
): Promise<GuardianNeed[]> {
  const { data: game } = await admin
    .from("hosted_games")
    .select("host_id")
    .eq("id", input.gameId)
    .maybeSingle();
  if (!game || game.host_id !== input.callerId) throw new Error("Only the host can see this");

  const { data: reqs } = await admin
    .from("join_requests")
    .select("id, player_id, status, guardian_approved_at")
    .eq("game_id", input.gameId)
    .in("status", ["pending", "approved"]);
  const rows = (reqs ?? []) as {
    id: string;
    player_id: string;
    guardian_approved_at: string | null;
  }[];
  if (rows.length === 0) return [];

  // The links in force: a link to someone who has turned 18 no longer needs a guardian (20261125200000).
  const { data: links } = await guardianLinksInForce(
    admin,
    rows.map((r) => r.player_id),
  );
  const withGuardian = new Set((links ?? []).map((l) => l.child_user_id));
  return rows.map((r) => ({
    requestId: r.id,
    needsGuardian: withGuardian.has(r.player_id),
    guardianApproved: !!r.guardian_approved_at,
  }));
}

import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserId } from "@/lib/current-user-id";
import { createNotification } from "@/lib/notifications";
import { isGameId } from "@/lib/game-flow-status";
import { withdrawMyApprovedJoinRequest } from "@/lib/payments";
import { leaveGame } from "@/lib/games-store";

/** Drop the viewer's unreviewed payment proof for a game. Best effort. */
export async function clearPendingSubmissions(gameId: string) {
  try {
    const uid = await getCurrentUserId();
    if (!uid) return;
    await supabase
      .from("payment_submissions")
      .delete()
      .eq("game_id", gameId)
      .eq("player_id", uid)
      .eq("status", "pending");
  } catch {
    /* best effort */
  }
}

/**
 * Tell the host a player gave up an approved or confirmed spot, matching what
 * the game page's own leave path does. Best effort — never blocks the leave.
 */
export async function notifyHostOfLeave(gameId: string) {
  if (!isGameId(gameId)) return;
  // The server finds the host, writes the text, and sends nothing inside the cutoff, where the database sends its own
  // "cancelled late" notice.
  await createNotification({ type: "participant_left", game_id: gameId });
}

/**
 * Give up an approved spot: clear any pending payment proof, release the
 * approval, drop the local joined flag and tell the host. Used wherever a
 * player can withdraw so every path does the same thing.
 */
export async function withdrawFromGame(gameId: string, gameTitle: string) {
  await clearPendingSubmissions(gameId);
  await withdrawMyApprovedJoinRequest(gameId);
  // The host is told once the roster row is gone: the server tells a host only about a player who is off the roster.
  void leaveGame(gameId).then(() => notifyHostOfLeave(gameId));
}

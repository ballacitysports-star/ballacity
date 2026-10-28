import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { isGameId } from "@/lib/game-flow-status";
import { withdrawMyApprovedJoinRequest } from "@/lib/payments";
import { leaveGame } from "@/lib/games-store";
import { isLateCancel } from "@/lib/cancel-window";

/** Drop the viewer's unreviewed payment proof for a game. Best effort. */
export async function clearPendingSubmissions(gameId: string) {
  try {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
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
export async function notifyHostOfLeave(gameId: string, fallbackTitle: string) {
  try {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid || !isGameId(gameId)) return;
    const [{ data: game }, { data: me }] = await Promise.all([
      supabase.from("hosted_games").select("*").eq("id", gameId).maybeSingle(),
      supabase.from("profiles").select("display_name").eq("id", uid).maybeSingle(),
    ]);
    const g = game as {
      host_id?: string;
      date?: string;
      cancel_cutoff_min?: number | null;
    } | null;
    const hostId = g?.host_id;
    if (!hostId || hostId === uid) return;
    // Inside the cutoff the database sends its own "cancelled late" notice.
    if (isLateCancel(g?.date, g?.cancel_cutoff_min)) return;
    const title = (game as { title?: string } | null)?.title ?? fallbackTitle;
    const who = (me as { display_name?: string } | null)?.display_name || "A player";
    await createNotification({
      user_id: hostId,
      type: "participant_left",
      title: `${who} left ${title}`,
      body: "Their spot is open again.",
      link: `/games/${gameId}`,
    });
  } catch {
    /* best effort */
  }
}

/**
 * Give up an approved spot: clear any pending payment proof, release the
 * approval, drop the local joined flag and tell the host. Used wherever a
 * player can withdraw so every path does the same thing.
 */
export async function withdrawFromGame(gameId: string, gameTitle: string) {
  await clearPendingSubmissions(gameId);
  await withdrawMyApprovedJoinRequest(gameId);
  leaveGame(gameId);
  void notifyHostOfLeave(gameId, gameTitle);
}

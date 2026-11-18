import { toast } from "sonner";
import { createNotification } from "@/lib/notifications";
import { blockUser as blockAccount } from "@/lib/moderation";

/** What Block means for a host: the account-level block, which the database enforces. */
export function blockConfirmText(name: string) {
  return `Block ${name}? This request is declined, and from now on they can't ask to join your games, message you or follow you. You can unblock them any time under Settings → Blocked users.`;
}

/** Records the block on the server. The decline has already been saved by then. */
export async function blockPlayer(playerId: string, name: string) {
  try {
    await blockAccount(playerId);
    toast.success(`${name} blocked.`);
  } catch (e) {
    toast.error(
      `Declined, but couldn't block ${name}${e instanceof Error && e.message ? ` (${e.message})` : ""}. Try again from their profile.`,
    );
  }
}

/**
 * Tells the player the host's answer. The server reads the saved decision, the game and its fee and writes the text;
 * a decline reason stays on the game page, where the player sees it.
 */
export async function notifyJoinReview(
  playerId: string,
  gameId: string,
  status: "approved" | "rejected",
) {
  await createNotification({
    type: status === "approved" ? "join_approved" : "join_declined",
    game_id: gameId,
    user_id: playerId,
  });
}

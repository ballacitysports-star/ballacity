import { toast } from "sonner";
import { createNotification } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { blockUser as blockAccount } from "@/lib/moderation";
import { userErrorMessage } from "@/lib/user-error";

/** What Block means for a host: the account-level block, which the database enforces. */
export function blockConfirmText(name: string) {
  return `Block ${name}? This request is declined, and from now on they can't request a spot in your games, message you or follow you. You can unblock them any time under Settings → Blocked users.`;
}

/**
 * Records the block on the server. What came before it (a decline, or the roster's removal) has already been saved by
 * then and stays, so a failed block says which of the two went through. Never throws.
 */
export async function blockPlayer(
  playerId: string,
  name: string,
  after: "declined" | "removed" = "declined",
) {
  try {
    await blockAccount(playerId);
    toast.success(`${name} blocked.`);
  } catch (e) {
    const done = after === "removed" ? "Removed" : "Declined";
    // The catalog or generic sentence when there is one, never the raw database text (WP 4.0).
    toast.error(
      `${done}, but couldn't block ${name}. ${userErrorMessage(e, "Try again from their profile.")}`,
    );
  }
}

export async function notifyJoinReview(
  playerId: string,
  gameId: string,
  gameTitle: string,
  status: "approved" | "rejected",
  reason?: string | null,
) {
  let fee = 0;
  if (status === "approved") {
    const { data } = await supabase
      .from("hosted_games")
      .select("price")
      .eq("id", gameId)
      .maybeSingle();
    fee = Number(data?.price ?? 0);
  }
  const paid = status === "approved" && fee > 0;
  await createNotification({
    user_id: playerId,
    type: status === "approved" ? "join_approved" : "join_declined",
    title: paid
      ? `Request approved — payment due for ${gameTitle}`
      : status === "approved"
        ? `You're in: ${gameTitle}`
        : `Request declined: ${gameTitle}`,
    body: paid
      ? `Pay $${fee} to the host to secure your spot. You'll be added to the roster once payment is confirmed.`
      : status === "approved"
        ? "The host approved your request."
        : reason
          ? `The host declined your request: ${reason}`
          : "The host declined your request.",
    link: paid ? `/games/${gameId}/pay` : `/games/${gameId}`,
  });
}

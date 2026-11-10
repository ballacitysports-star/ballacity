import { toast } from "sonner";
import { createNotification } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
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

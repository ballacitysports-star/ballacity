import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  gameInviteErrorMessage,
  getGameInvite,
  respondToGameInvite,
  type GameInvite,
} from "@/lib/game-invites";

/**
 * WP 2.0: the invitation a player opened from their notification (`?inv=<id>`). While it waits for an answer the player can
 * accept, which approves their place at once (the page then shows the usual next step: join, or pay), or decline. Once
 * answered it shows nothing, or one line when the invitation is over. Shown only to the invitee: anyone else reading the
 * link gets no row back and sees nothing.
 */
export function GameInviteBanner({
  inviteId,
  viewerId,
  onAnswered,
}: {
  inviteId: string;
  viewerId: string | null;
  onAnswered: () => void;
}) {
  const [invite, setInvite] = useState<GameInvite | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!viewerId) return;
    getGameInvite(inviteId)
      .then((row) => {
        if (live) setInvite(row);
      })
      .catch(() => {
        if (live) setInvite(null);
      })
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [inviteId, viewerId]);

  if (!viewerId || !loaded || !invite || invite.invitee_id !== viewerId) return null;

  const answer = async (accept: boolean) => {
    setBusy(accept ? "accept" : "decline");
    try {
      const res = await respondToGameInvite(invite.id, accept);
      if (res.status === "accepted") {
        toast.success("You're in. The host has been told.");
        setInvite({ ...invite, status: "accepted" });
        onAnswered();
      } else if (res.status === "declined") {
        toast.success("Invitation declined");
        setInvite({ ...invite, status: "declined" });
      } else if (res.status === "full") {
        setNote("This game is full right now. Your invitation stays open if a spot frees up.");
      } else if (res.status === "expired") {
        setInvite({ ...invite, status: "expired" });
      } else {
        setInvite({ ...invite, status: res.status });
        onAnswered();
      }
    } catch (e) {
      toast.error(gameInviteErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (invite.status === "expired" || invite.status === "cancelled") {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4 text-sm" role="status">
        {invite.status === "cancelled"
          ? "The host withdrew this invitation."
          : "This invitation has ended."}
      </div>
    );
  }
  if (invite.status !== "pending") return null;

  return (
    <section
      aria-label="Your invitation"
      className="rounded-2xl border border-lime/40 bg-lime/10 p-4"
      data-testid="game-invite-banner"
    >
      <div className="font-display text-sm font-bold">You're invited to this game</div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Accept to take your spot. The usual steps still apply: payment if the game has a fee, and a
        parent or guardian's OK for players under 18.
      </p>
      {invite.message && (
        <p className="mt-2 whitespace-pre-line rounded-xl bg-background/40 p-2 text-sm">
          “{invite.message}”
        </p>
      )}
      {note && <p className="mt-2 text-xs font-semibold text-coral">{note}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void answer(true)}
          className="inline-flex min-h-11 items-center gap-1 rounded-full bg-lime-gradient px-5 text-sm font-bold text-primary-foreground disabled:opacity-60"
        >
          {busy === "accept" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Accept
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void answer(false)}
          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-5 text-sm font-semibold disabled:opacity-60"
        >
          {busy === "decline" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Decline
        </button>
      </div>
    </section>
  );
}

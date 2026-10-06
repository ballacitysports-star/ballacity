import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Timer, ListOrdered } from "lucide-react";
import { toast } from "sonner";
import {
  leaveWaitlist,
  promoteWaitlistSafely,
  useWaitlistRanks,
  type WaitlistEntry,
} from "@/lib/waitlist-store";
import {
  formatOfferCountdown,
  offerSecondsRemaining,
  waitlistRankLabel,
} from "@/lib/waitlist-promotion";

const errorMessage = (e: unknown, fallback: string) =>
  (e instanceof Error && e.message) || fallback;

/** Ticks once a second while `expiresAt` is in the future. */
function useOfferSeconds(expiresAt: string | null): number {
  const [secs, setSecs] = useState(() => offerSecondsRemaining(expiresAt));
  useEffect(() => {
    setSecs(offerSecondsRemaining(expiresAt));
    if (!expiresAt) return;
    const id = window.setInterval(() => setSecs(offerSecondsRemaining(expiresAt)), 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  return secs;
}

function OfferBanner({
  entry,
  gameId,
  onChanged,
}: {
  entry: WaitlistEntry;
  gameId: string;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const secs = useOfferSeconds(entry.offerExpiresAt);
  const [busy, setBusy] = useState<"claim" | "decline" | null>(null);
  const claimed = !!entry.claimedAt;
  const sweptRef = useRef(false);

  // When the window closes, ask the server to release it so the next player is
  // offered the spot even if nobody else has the page open. A claimed offer is
  // left to the server: a pending payment keeps it held past the timer.
  useEffect(() => {
    if (secs > 0 || sweptRef.current || claimed || !entry.offerExpiresAt) return;
    sweptRef.current = true;
    void promoteWaitlistSafely(gameId).then(onChanged);
  }, [secs, claimed, entry.offerExpiresAt, gameId, onChanged]);

  const claim = async () => {
    setBusy("claim");
    try {
      const { claimWaitlistOffer } = await import("@/lib/waitlist-promotion.functions");
      const { result } = await claimWaitlistOffer({ data: { waitlistId: entry.id } });
      if (result === "expired") {
        toast.error("That offer expired and the spot moved to the next player.");
      } else if (result === "joined") {
        toast.success("You're on the roster!");
      } else {
        toast.success("Spot held — finish payment to lock it in.");
        void navigate({ to: "/games/$gameId/pay", params: { gameId }, search: {} });
      }
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Could not claim this spot."));
    } finally {
      setBusy(null);
    }
  };

  const decline = async () => {
    setBusy("decline");
    try {
      const { declineWaitlistOffer } = await import("@/lib/waitlist-promotion.functions");
      await declineWaitlistOffer({ data: { waitlistId: entry.id } });
      toast("You passed on this spot.");
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Could not decline this spot."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      role="status"
      className="rounded-2xl border border-lime/50 bg-lime/10 px-3 py-3"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <Timer className="mt-0.5 h-4 w-4 shrink-0 text-lime" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">A spot opened!</p>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {claimed ? "Your spot is held for the " : "Claim your spot as the "}
            <span className="font-semibold text-foreground">{entry.position}</span>
            {claimed ? " — finish payment before it expires." : " before the timer expires."}
          </p>
          <p
            className="mt-1 font-display text-2xl font-bold tabular-nums text-lime"
            aria-label={`${formatOfferCountdown(secs)} remaining`}
          >
            {secs > 0 ? formatOfferCountdown(secs) : "Expired"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null || (secs === 0 && !claimed)}
          onClick={() => void claim()}
          className="inline-flex items-center gap-1 rounded-full border border-lime bg-lime px-4 py-1.5 text-xs font-bold text-background transition hover:opacity-90 active:scale-95 disabled:opacity-60"
        >
          {busy === "claim" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {claimed ? "Continue to payment" : "Claim spot"}
        </button>
        {!claimed && (
          <button
            type="button"
            disabled={busy !== null || secs === 0}
            onClick={() => void decline()}
            className="inline-flex items-center gap-1 rounded-full border border-border px-4 py-1.5 text-xs font-bold text-muted-foreground transition hover:bg-secondary active:scale-95 disabled:opacity-60"
          >
            {busy === "decline" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            No thanks
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The signed-in player's waitlist state for one game: live queue rank
 * ("You're #2 on the Guard waitlist") and, when a spot is offered to them, a
 * claim banner with the countdown.
 */
export function WaitlistStatusCard({
  gameId,
  entries,
  userId,
}: {
  gameId: string;
  /** Waitlist entries for the game (RLS already limits a player to their own). */
  entries: WaitlistEntry[];
  userId: string;
}) {
  const qc = useQueryClient();
  const mine = entries.filter((e) => e.userId === userId);
  const { data: ranks } = useWaitlistRanks(gameId, mine.length > 0);

  const onChanged = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["waitlist-ranks", gameId] });
  }, [qc, gameId]);

  // Realtime only tells us about this player's own rows; refresh the rank when
  // they change (e.g. an offer appears or lapses).
  const signature = mine.map((e) => `${e.id}:${e.status}`).join(",");
  useEffect(() => {
    onChanged();
  }, [signature, onChanged]);

  if (mine.length === 0) return null;

  const offered = mine.filter((e) => e.status === "offered");
  const queued = mine.filter((e) => e.status === "waiting" || e.status === "approved");

  return (
    <div className="mt-3 space-y-2">
      {offered.map((e) => (
        <OfferBanner key={e.id} entry={e} gameId={gameId} onChanged={onChanged} />
      ))}

      {queued.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-coral/40 bg-coral/5 px-3 py-2">
          <div className="min-w-0 space-y-0.5">
            {queued.map((e) => {
              const rank = ranks?.find((r) => r.entryId === e.id);
              return (
                <p key={e.id} className="flex items-center gap-1.5 text-[12px] font-semibold">
                  <ListOrdered className="h-3.5 w-3.5 shrink-0 text-coral" aria-hidden />
                  {rank
                    ? waitlistRankLabel(rank.rank, queued.length > 1 ? e.position : null)
                    : `On the ${e.position} waitlist`}
                </p>
              );
            })}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              We’ll notify you the moment a spot opens up.
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                await Promise.all(queued.map((w) => leaveWaitlist(gameId, w.position)));
                toast(
                  queued.length > 1
                    ? "Removed from all waitlists for this game."
                    : `Removed from the ${queued[0]!.position} waitlist.`,
                );
                onChanged();
              } catch (e) {
                toast.error(errorMessage(e, "Could not leave waitlist."));
              }
            }}
            aria-label={queued.length > 1 ? "Leave all waitlists" : "Leave waitlist"}
            className="rounded-full border border-coral bg-coral px-3 py-1.5 text-[11px] font-bold text-background transition hover:opacity-90 active:scale-95"
          >
            {queued.length > 1 ? "Leave all waitlists" : "Leave waitlist"}
          </button>
        </div>
      )}
    </div>
  );
}

import { XCircle } from "lucide-react";
import { formatCooldownLabel } from "@/components/game-detail/GameDetailBits";
import { useResubmitCooldownMs } from "@/hooks/use-resubmit-cooldown";
import { removedBannerCopy } from "@/lib/host-removal";
import { JOIN_RESUBMIT_MAX_ATTEMPTS, type JoinRequest } from "@/lib/payments";

/**
 * The game page's banner for a player the host removed from the game (src/lib/host-removal.ts): what happened and the
 * way back (asking the host, or an invitation), with the resend cooldown and attempt cap of their request.
 */
export function GameRemovedBanner({
  myReq,
  capReached,
  paymentVerified,
  locked,
  full,
}: {
  myReq: JoinRequest | null;
  capReached: boolean;
  paymentVerified: boolean;
  /** New joins are locked (the game's join gate): no request can be sent. */
  locked: boolean;
  /** The roster is full: the ask waits for a spot (the waitlist never tells a removed player). */
  full: boolean;
}) {
  // Ticks once a second only while a resubmit cooldown runs.
  const cooldownMs = useResubmitCooldownMs(myReq);
  const copy = removedBannerCopy({
    requestPending: myReq?.status === "pending",
    locked,
    full,
    capReached: myReq?.status === "rejected" && capReached,
    cooldownLabel:
      myReq?.status === "rejected" && cooldownMs > 0 ? formatCooldownLabel(cooldownMs) : null,
    attemptLimit: JOIN_RESUBMIT_MAX_ATTEMPTS,
    paymentVerified,
  });
  return (
    <div
      className="rounded-2xl border border-border bg-surface p-4 flex items-start gap-3"
      role="status"
      aria-live="polite"
      data-testid="removed-by-host"
    >
      <XCircle className="h-5 w-5 shrink-0 mt-0.5 text-muted-foreground" />
      <div className="min-w-0">
        <div className="font-display text-sm font-bold">{copy.title}</div>
        <p className="text-xs text-muted-foreground mt-0.5">{copy.body}</p>
      </div>
    </div>
  );
}

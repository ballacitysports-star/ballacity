import { Clock, Check, X as XIcon } from "lucide-react";
import { playerWaitCopy, type JoinWait } from "@/lib/join-guardian-status";
import { LeaveFlowButton } from "@/components/LeaveFlowButton";
import { JOIN_RESUBMIT_MAX_ATTEMPTS, type JoinRequest } from "@/lib/payments";
import { formatCooldownLabel } from "@/components/game-detail/GameDetailBits";
import { useResubmitCooldownMs } from "@/hooks/use-resubmit-cooldown";
import { type Game } from "@/lib/sample-data";
import { type PlayerFlowStatus } from "@/lib/game-flow-status";

export type GameApprovalBannerProps = {
  capReached: boolean;
  fee: number;
  game: Game;
  isHost: boolean;
  isPaid: boolean;
  isPaymentVerified: boolean;
  myFlowStatus: PlayerFlowStatus;
  myHoldLabel: string | null;
  myReq: JoinRequest | null;
  myWait: JoinWait | null;
  refreshStatus: () => Promise<void>;
  requiresApproval: boolean;
};

export function GameApprovalBanner({
  capReached,
  fee,
  game,
  isHost,
  isPaid,
  isPaymentVerified,
  myFlowStatus,
  myHoldLabel,
  myReq,
  myWait,
  refreshStatus,
  requiresApproval,
}: GameApprovalBannerProps) {
  // Ticks once a second only while a resubmit cooldown runs.
  const cooldownMs = useResubmitCooldownMs(myReq);
  return (
    <>
      {/* Approval status banner (player view).
            Driven by the shared useMyFlowStatus so paid games always show
            "Payment due" (or the matching payment stage) until the host
            verifies the payment — never "You're approved / on the roster". */}
      {myWait && (
        <div
          className="rounded-2xl border border-coral/40 bg-coral/10 p-4 flex items-start gap-3"
          role="status"
          aria-live="polite"
          data-testid="waiting-on-parent"
        >
          <Clock className="h-5 w-5 shrink-0 mt-0.5 text-coral" />
          <div className="min-w-0">
            <div className="font-display text-sm font-bold">{playerWaitCopy(myWait).title}</div>
            <p className="text-xs text-muted-foreground mt-0.5">{playerWaitCopy(myWait).body}</p>
            {myReq?.status === "pending" && (
              <div className="mt-3">
                <LeaveFlowButton
                  gameId={game.id}
                  gameTitle={game.title}
                  variant="danger"
                  onDone={() => void refreshStatus()}
                />
              </div>
            )}
          </div>
        </div>
      )}
      {!isHost &&
        !myWait &&
        requiresApproval &&
        myReq &&
        (() => {
          // Paid games: pick copy from the shared flow status so this banner
          // can't disagree with the pill / PaymentRequiredBanner / pay page.
          if (isPaid) {
            const paidCopy: Record<
              string,
              { title: string; body: string; tone: "warn" | "info" | "ok" | "bad" | "muted" }
            > = {
              requested: {
                title: "Waiting for host approval",
                body: "Your spot isn't held until the host approves. You'll get a notification when they respond.",
                tone: "warn",
              },
              payment_pending: {
                title: myHoldLabel
                  ? `Approved · Pay host directly to lock your spot · ⏳ ${myHoldLabel}`
                  : "Approved · Pay host directly to lock your spot",
                body: myHoldLabel
                  ? `Send your $${fee} fee to the host and submit proof before the hold runs out, or your spot goes to the next player.`
                  : `Send your $${fee} fee to the host and submit proof — your spot isn't locked until they confirm it.`,
                tone: "warn",
              },
              payment_submitted: {
                title: "Proof sent · Awaiting host confirmation",
                body: "Your proof is with the host. You'll be confirmed the moment they verify it.",
                tone: "info",
              },
              payment_rejected: {
                title: myHoldLabel
                  ? `Payment declined by host · Resubmit proof or message host · ⏳ ${myHoldLabel}`
                  : "Payment declined by host · Resubmit proof or message host",
                body:
                  myReq.reviewer_notes ||
                  "The host couldn't verify your last payment. Send new proof to lock your spot.",
                tone: "bad",
              },
              payment_verified: {
                title: "You're in! Payment confirmed",
                body: "You're all set. See you at the game!",
                tone: "ok",
              },
              confirmed: {
                title: "You're in! Payment confirmed",
                body: "You're all set. See you at the game!",
                tone: "ok",
              },
              rejected: {
                title: "Request declined",
                body: capReached
                  ? `${myReq.reviewer_notes ? `${myReq.reviewer_notes} · ` : ""}You've reached the ${JOIN_RESUBMIT_MAX_ATTEMPTS}-attempt limit for this game. Message the host instead.`
                  : cooldownMs > 0
                    ? `${myReq.reviewer_notes ? `${myReq.reviewer_notes} · ` : ""}You can resubmit in ${formatCooldownLabel(cooldownMs)}.`
                    : `${myReq.reviewer_notes ? `${myReq.reviewer_notes} · ` : ""}You can send another request or message the host.`,
                tone: "muted",
              },
            };
            const entry = paidCopy[myFlowStatus];
            if (!entry) return null;
            const toneClass =
              entry.tone === "warn"
                ? "border-coral/40 bg-coral/10"
                : entry.tone === "bad"
                  ? "border-destructive/50 bg-destructive/10"
                  : entry.tone === "ok"
                    ? "border-lime/40 bg-lime/10"
                    : entry.tone === "info"
                      ? "border-lime/40 bg-lime/5"
                      : "border-border bg-surface";
            const Icon =
              entry.tone === "warn" || entry.tone === "info"
                ? Clock
                : entry.tone === "ok"
                  ? Check
                  : entry.tone === "bad"
                    ? XIcon
                    : XIcon;
            const iconColor =
              entry.tone === "warn"
                ? "text-coral"
                : entry.tone === "ok"
                  ? "text-lime"
                  : entry.tone === "bad"
                    ? "text-destructive"
                    : entry.tone === "info"
                      ? "text-lime"
                      : "text-muted-foreground";
            return (
              <div
                className={`rounded-2xl border p-4 flex items-start gap-3 ${toneClass}`}
                role="status"
                aria-live="polite"
              >
                <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${iconColor}`} />
                <div className="min-w-0">
                  <div className="font-display text-sm font-bold">{entry.title}</div>
                  <p className="text-xs text-muted-foreground mt-0.5">{entry.body}</p>
                  {/* A request is the player's to take back until the host answers. */}
                  {myFlowStatus === "requested" && (
                    <div className="mt-3">
                      <LeaveFlowButton
                        gameId={game.id}
                        gameTitle={game.title}
                        variant="danger"
                        onDone={() => void refreshStatus()}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          }

          // Free games: original approval-only copy (no payment stage exists).
          return (
            <div
              className={`rounded-2xl border p-4 flex items-start gap-3 ${
                myReq.status === "pending"
                  ? "border-coral/40 bg-coral/10"
                  : myReq.status === "approved"
                    ? "border-lime/40 bg-lime/10"
                    : "border-border bg-surface"
              }`}
              role="status"
              aria-live="polite"
            >
              {myReq.status === "pending" ? (
                <Clock className="h-5 w-5 text-coral shrink-0 mt-0.5" />
              ) : myReq.status === "approved" ? (
                <Check className="h-5 w-5 text-lime shrink-0 mt-0.5" />
              ) : (
                <XIcon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="font-display text-sm font-bold">
                  {myReq.status === "pending"
                    ? "Waiting for host approval"
                    : myReq.status === "approved"
                      ? isPaid && !isPaymentVerified
                        ? "Approved — payment due"
                        : "You're approved — see you there!"
                      : "Request declined"}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {myReq.status === "pending"
                    ? "Your spot isn't held until the host approves. You'll get a notification when they respond."
                    : myReq.status === "approved"
                      ? isPaid && !isPaymentVerified
                        ? `Payment due: pay $${fee} to the host to lock in your spot. You'll be added to the roster once it's confirmed.`
                        : "The host approved your request. You're on the roster."
                      : capReached
                        ? `${myReq.reviewer_notes ? `${myReq.reviewer_notes} · ` : ""}You've reached the ${JOIN_RESUBMIT_MAX_ATTEMPTS}-attempt limit for this game. Message the host instead.`
                        : cooldownMs > 0
                          ? `${myReq.reviewer_notes ? `${myReq.reviewer_notes} · ` : ""}You can resubmit in ${formatCooldownLabel(cooldownMs)}.`
                          : `${myReq.reviewer_notes ? `${myReq.reviewer_notes} · ` : ""}You can send another request or message the host.`}
                </p>
                {myReq.status === "pending" && (
                  <div className="mt-3">
                    <LeaveFlowButton
                      gameId={game.id}
                      gameTitle={game.title}
                      variant="danger"
                      onDone={() => void refreshStatus()}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })()}
    </>
  );
}

import { useNavigate } from "@tanstack/react-router";
import { CreditCard, AlertCircle } from "lucide-react";
import type { GamePaymentSettings } from "@/lib/payments";
import type { PlayerFlowStatus } from "@/lib/game-flow-status";

function formatDeadline(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PaymentRequiredBanner({
  gameId,
  settings,
  status,
}: {
  gameId: string;
  settings: GamePaymentSettings | null;
  status: PlayerFlowStatus;
}) {
  const navigate = useNavigate();
  if (!settings || Number(settings.entry_fee ?? 0) <= 0) return null;
  if (status !== "payment_pending" && status !== "payment_rejected") return null;

  const isRejected = status === "payment_rejected";
  const deadline = formatDeadline(settings.payment_deadline);
  const amount = `$${Number(settings.entry_fee).toFixed(2).replace(/\.00$/, "")}`;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="payment-required-banner"
      className={`rounded-2xl border p-4 flex items-start gap-3 ${
        isRejected ? "border-destructive/50 bg-destructive/10" : "border-coral/50 bg-coral/10"
      }`}
    >
      <div
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
          isRejected ? "bg-destructive/20 text-destructive" : "bg-coral/20 text-coral"
        }`}
      >
        {isRejected ? <AlertCircle className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-sm font-bold">
          {isRejected
            ? "Payment declined by host · Resubmit proof or message host"
            : "Payment required"}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {isRejected
            ? `The host rejected your last payment of ${amount}. Send new proof to lock your spot.`
            : `Submit ${amount}${deadline ? ` by ${deadline}` : ""} to confirm your spot on the roster.`}
        </p>
        <button
          type="button"
          onClick={() => navigate({ to: "/games/$gameId/pay", params: { gameId } })}
          className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold ${
            isRejected
              ? "bg-destructive text-destructive-foreground"
              : "bg-lime-gradient text-primary-foreground glow-lime"
          }`}
        >
          <CreditCard className="h-3.5 w-3.5" />
          {isRejected ? "Resubmit payment" : `Pay ${amount} now`}
        </button>
      </div>
    </div>
  );
}

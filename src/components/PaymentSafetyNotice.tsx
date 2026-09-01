import { useState } from "react";
import { Flag, ShieldAlert } from "lucide-react";
import {
  PAYMENT_DISCLAIMER,
  PAYMENT_PRESSURE_WARNING,
  PAYMENT_SAFETY_TIPS,
} from "@/lib/payment-states";
import { ReportDialog } from "@/components/ReportDialog";

type Props = {
  /** The other party in the payment (usually the host) — enables scam reporting. */
  counterpartyId?: string | null;
  counterpartyLabel?: string;
  gameId?: string | null;
  /** Show the extra "pressure" warning (e.g. unusually high fee). */
  showPressureWarning?: boolean;
  className?: string;
};

export function PaymentSafetyNotice({
  counterpartyId,
  counterpartyLabel = "this host",
  gameId,
  showPressureWarning = false,
  className = "",
}: Props) {
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <div
      data-testid="payment-safety-notice"
      className={`rounded-2xl border border-coral/40 bg-coral/5 p-4 text-xs ${className}`}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-coral" aria-hidden="true" />
        <div className="space-y-2">
          <p className="text-sm font-bold text-foreground">Pay safely</p>
          <p className="text-muted-foreground">{PAYMENT_DISCLAIMER}</p>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
            {PAYMENT_SAFETY_TIPS.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
          {showPressureWarning && (
            <p className="rounded-xl border border-coral/40 bg-background p-2 font-medium text-coral">
              {PAYMENT_PRESSURE_WARNING}
            </p>
          )}
          {counterpartyId && (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              data-testid="report-payment-scam"
              className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-coral/50 px-3 py-1.5 font-bold text-coral transition hover:bg-coral/10"
            >
              <Flag className="h-3.5 w-3.5" /> Report a payment scam
            </button>
          )}
        </div>
      </div>

      {counterpartyId && (
        <ReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          subjectType="payment"
          reportedId={counterpartyId}
          subjectLabel={counterpartyLabel}
          gameId={gameId ?? null}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Loader2, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LEGAL_REVIEW_LABEL, RISK_ACKNOWLEDGMENT } from "@/lib/safety";

/**
 * Shown before a player joins a physical game. The checkbox is never
 * pre-checked, and confirming records the acknowledgment version.
 */
export function RiskAcknowledgmentDialog({
  open,
  onOpenChange,
  gameTitle,
  submitting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  gameTitle: string;
  submitting?: boolean;
  onConfirm: () => void;
}) {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!open) setChecked(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-lime" aria-hidden />
            {RISK_ACKNOWLEDGMENT.title}
          </DialogTitle>
          <DialogDescription className="truncate">{gameTitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="rounded-2xl border border-border bg-surface px-3 py-3 text-xs leading-relaxed text-foreground">
            {RISK_ACKNOWLEDGMENT.text}
          </p>
          <ul className="space-y-1.5">
            {RISK_ACKNOWLEDGMENT.points.map((p) => (
              <li key={p} className="flex gap-2 text-[12px] leading-relaxed text-muted-foreground">
                <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
                {p}
              </li>
            ))}
          </ul>

          <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface px-3 py-3">
            <button
              type="button"
              id="risk-ack-checkbox"
              role="checkbox"
              aria-checked={checked}
              disabled={submitting}
              onClick={() => setChecked((v) => !v)}
              className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border transition disabled:opacity-50 ${
                checked
                  ? "border-lime bg-lime text-primary-foreground"
                  : "border-border bg-background"
              }`}
            >
              {checked ? <Check className="h-4 w-4" aria-hidden /> : null}
            </button>
            <label htmlFor="risk-ack-checkbox" className="flex-1 text-xs leading-relaxed">
              {RISK_ACKNOWLEDGMENT.checkboxLabel}
            </label>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="mr-1 rounded bg-secondary px-1.5 py-0.5 micro-label">
              {LEGAL_REVIEW_LABEL}
            </span>
            {RISK_ACKNOWLEDGMENT.disclaimer} Read the{" "}
            <Link to="/safety" target="_blank" rel="noreferrer" className="text-lime underline">
              Safety Center
            </Link>
            .
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!checked || submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Agree & join
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

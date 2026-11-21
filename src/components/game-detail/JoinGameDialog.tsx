import { useState, type ReactNode } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RiskAcknowledgmentFields } from "@/components/safety/RiskAcknowledgmentDialog";
import { RISK_ACKNOWLEDGMENT } from "@/lib/safety";
import { JOIN_GAME_TITLE, canConfirmJoin, joinGameActionLabel } from "@/lib/join-dialog";

/**
 * One dialog for joining a free game: the roster and cancellation line, the
 * reminder picker (`children`), and, when this player has not acknowledged the
 * current version for this game, the "Before you join" risk acknowledgment
 * with the same unchecked checkbox, wording and legal-review tag as the
 * standalone RiskAcknowledgmentDialog. "Agree & join" stays disabled until it
 * is ticked. A player whose acknowledgment is already on file sees no checkbox.
 *
 * The caller decides `needsAck` before opening (planRiskAckTap /
 * settleRiskAckTap), records the acknowledgment in `onConfirm` before it joins,
 * and keeps refusals ahead of the dialog (joinTapStep).
 */
export function JoinGameDialog({
  open,
  onOpenChange,
  gameTitle,
  rosterNote,
  needsAck,
  submitting = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  gameTitle: string;
  /** "You'll be added to the roster." plus the cancellation note. */
  rosterNote: string;
  needsAck: boolean;
  submitting?: boolean;
  onConfirm: () => void;
  /** Extra content above the acknowledgment (the reminder picker). */
  children?: ReactNode;
}) {
  const [checked, setChecked] = useState(false);
  // The caller clears its state as it closes the dialog, but the content stays
  // on screen for the close animation. Keep showing what was shown while open,
  // so the acknowledgment section and the button label don't change during the fade.
  const [shownNeedsAck, setShownNeedsAck] = useState(needsAck);
  if (open && shownNeedsAck !== needsAck) setShownNeedsAck(needsAck);
  const ackDue = open ? needsAck : shownNeedsAck;
  // Every open asks again: the tick is cleared as the dialog opens (not as it
  // closes, so it doesn't untick on screen during the fade).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setChecked(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{JOIN_GAME_TITLE}</DialogTitle>
          <DialogDescription className="truncate">{gameTitle}</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{rosterNote}</p>

        {children}

        {ackDue ? (
          <section aria-labelledby="join-risk-ack-heading" className="space-y-3">
            <h3
              id="join-risk-ack-heading"
              className="flex items-center gap-2 font-display text-base font-bold"
            >
              <ShieldAlert className="h-5 w-5 text-lime" aria-hidden />
              {RISK_ACKNOWLEDGMENT.title}
            </h3>
            <RiskAcknowledgmentFields
              checked={checked}
              onCheckedChange={setChecked}
              disabled={submitting}
            />
          </section>
        ) : null}

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            className="min-h-11"
            onClick={onConfirm}
            disabled={!canConfirmJoin({ needsAck: ackDue, checked, submitting })}
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            {joinGameActionLabel(ackDue)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

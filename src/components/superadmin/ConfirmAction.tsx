import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ConfirmActionProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** When set, the user must type this word to enable the confirm button. */
  confirmWord?: string;
  requireReason?: boolean;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: (reason: string) => void;
};

export function ConfirmAction({
  open,
  onOpenChange,
  title,
  description,
  confirmWord,
  requireReason = true,
  confirmLabel = "Confirm",
  pending,
  onConfirm,
}: ConfirmActionProps) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");

  const ready =
    (!confirmWord || typed.trim().toUpperCase() === confirmWord.toUpperCase()) &&
    (!requireReason || reason.trim().length >= 3);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setReason("");
          setTyped("");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-3">
          {requireReason ? (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Reason (recorded in audit log)
              </label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why are you doing this?"
                rows={3}
              />
            </div>
          ) : null}
          {confirmWord ? (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Type <span className="font-mono font-semibold">{confirmWord}</span> to confirm
              </label>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ready || pending} onClick={() => onConfirm(reason.trim())}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

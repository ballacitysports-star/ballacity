import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Confirmation for cancelling something on behalf of a child. */
export function CancelForChildDialog({
  open,
  title,
  description,
  lateWarning,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  /** Set when cancelling now would be a late cancellation. */
  lateWarning: string | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {lateWarning && (
          <p
            role="alert"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs font-medium text-amber-500"
          >
            {lateWarning}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className="bg-coral text-primary-foreground hover:bg-coral/90"
          >
            {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {busy ? "Cancelling…" : "Yes, cancel"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

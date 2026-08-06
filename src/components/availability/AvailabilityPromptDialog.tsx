import { Link } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "availability-prompt-dismissed";

/** True once the viewer chose "Continue anyway" in this browser session. */
export function availabilityPromptDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissAvailabilityPrompt() {
  try {
    sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * Soft prompt shown before a game join when the viewer has no open player
 * availability. Never hard-blocks — "Continue anyway" proceeds for the session.
 */
export function AvailabilityPromptDialog({
  open,
  onClose,
  onContinue,
}: {
  open: boolean;
  onClose: () => void;
  /** Proceed with the original action. */
  onContinue: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-lime" aria-hidden />
            Add your player availability
          </DialogTitle>
          <DialogDescription>
            Hosts pick players from availability posts — the days, times, and sports you're free to
            play. Adding yours makes it much likelier you get picked up.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link to="/players" search={{ tab: "mine" }} onClick={onClose}>
              Add my availability
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              dismissAvailabilityPrompt();
              onClose();
              onContinue();
            }}
          >
            Continue anyway
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Dismissible inline banner for team game management surfaces. */
export function AvailabilityPromptBanner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-dashed border-border bg-surface/60 p-4 text-sm ${className}`}
      role="status"
    >
      <div className="flex items-start gap-2">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold">Add your player availability</p>
          <p className="mt-1 text-muted-foreground">
            Your player profile has no open availability post yet. Adding one lets other hosts find
            you when you're free to play.
          </p>
          <Link
            to="/players"
            search={{ tab: "mine" }}
            className="mt-3 inline-flex rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground"
          >
            Add my availability
          </Link>
        </div>
      </div>
    </div>
  );
}

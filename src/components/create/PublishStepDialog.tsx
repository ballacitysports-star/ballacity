import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HostResponsibilityNotice } from "@/components/safety/HostResponsibilityNotice";

export type PublishSummaryLine = { label: string; value: string };

/**
 * The Publish step of "Host a game" (WP 4.2). The form's button only checks the
 * fields and opens this step; the game is published from here, and only once
 * the host has ticked the host-responsibility acknowledgment (same copy, legal
 * tag and recording as before; never pre-checked). It lives outside the form,
 * so Enter in a field can't publish past it.
 */
export function PublishStepDialog({
  open,
  onOpenChange,
  summary,
  accepted,
  onAcceptedChange,
  publishing,
  onPublish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: PublishSummaryLine[];
  accepted: boolean;
  onAcceptedChange: (v: boolean) => void;
  publishing: boolean;
  onPublish: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Stay open while the game is being published.
        if (!next && publishing) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish this game?</DialogTitle>
          <DialogDescription>
            Check the details, then confirm your host responsibilities to publish.
          </DialogDescription>
        </DialogHeader>

        <dl
          className="space-y-1.5 rounded-2xl border border-border bg-surface px-4 py-3 text-sm"
          data-testid="publish-summary"
        >
          {summary.map((line) => (
            <div key={line.label} className="flex gap-3">
              <dt className="w-16 shrink-0 text-xs font-semibold text-muted-foreground">
                {line.label}
              </dt>
              <dd className="min-w-0 break-words">{line.value}</dd>
            </div>
          ))}
        </dl>

        <HostResponsibilityNotice
          accepted={accepted}
          onChange={onAcceptedChange}
          disabled={publishing}
        />

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={publishing}
            className="min-h-11 rounded-2xl border border-border px-4 text-sm font-semibold disabled:opacity-60"
          >
            Back to edit
          </button>
          <button
            type="button"
            onClick={onPublish}
            disabled={!accepted || publishing}
            className="min-h-11 rounded-2xl bg-lime-gradient px-4 text-sm font-bold text-primary-foreground glow-lime disabled:opacity-60"
          >
            {publishing ? "Publishing…" : accepted ? "Publish game" : "Acknowledge to publish"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

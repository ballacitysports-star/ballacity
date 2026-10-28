import { useState } from "react";
import { Ban, Flag } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReportDialog } from "@/components/ReportDialog";
import { useBlock } from "@/lib/moderation";

/**
 * Report or block the person on the other end of a conversation.
 *
 * Reporting one message needed a hover-only control; this is the always-visible
 * way to raise a problem with the person, including before accepting a request
 * from someone you don't know.
 */
export function ThreadSafetyDialog({
  open,
  onOpenChange,
  userId,
  displayName,
  conversationId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  displayName: string;
  conversationId: string;
}) {
  const block = useBlock(userId);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const close = (v: boolean) => {
    if (!v) setConfirming(false);
    onOpenChange(v);
  };

  const toggleBlock = async () => {
    try {
      await block.toggle();
      toast.success(block.blocked ? `${displayName} unblocked.` : `${displayName} blocked.`);
      close(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the block. Try again.");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{displayName}</DialogTitle>
            <DialogDescription>
              Something wrong? Reports go to BallaCity moderators only. The person is never shown
              who reported them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                close(false);
                setReportOpen(true);
              }}
              className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left text-sm font-semibold"
            >
              <Flag className="h-4 w-4 text-coral" aria-hidden />
              Report {displayName}
            </button>

            {confirming && !block.blocked ? (
              <div className="rounded-2xl border border-coral/40 bg-coral/5 p-3 text-sm">
                <p className="font-semibold">Block {displayName}?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  You won&apos;t be able to message each other, and any follows between you are
                  removed. You can unblock them any time from Settings.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="flex-1 rounded-full border border-border bg-background py-2 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={block.pending}
                    onClick={() => void toggleBlock()}
                    className="flex-1 rounded-full bg-coral py-2 text-xs font-bold text-white disabled:opacity-60"
                  >
                    {block.pending ? "Blocking…" : "Block"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={block.loading || block.pending}
                onClick={() => (block.blocked ? void toggleBlock() : setConfirming(true))}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left text-sm font-semibold disabled:opacity-60"
              >
                <Ban className="h-4 w-4 text-coral" aria-hidden />
                {block.blocked ? `Unblock ${displayName}` : `Block ${displayName}`}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        subjectType="user"
        reportedId={userId}
        subjectLabel={displayName}
        conversationId={conversationId}
      />
    </>
  );
}

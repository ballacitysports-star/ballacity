import { useState } from "react";
import { toast } from "sonner";
import { errorText, userErrorMessage } from "@/lib/user-error";

import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  POST_REPORT_UNAVAILABLE_MESSAGE,
  reasonsFor,
  reportPost,
  submitReport,
  type ReportReason,
  type ReportSubjectType,
} from "@/lib/moderation";

/** submitReport's and reportPost's own sentences (moderation.ts). */
const REPORT_OWN_MESSAGES: ReadonlySet<string> = new Set([
  "Sign in to report",
  "You cannot report yourself",
  POST_REPORT_UNAVAILABLE_MESSAGE,
]);

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  subjectType: ReportSubjectType;
  /** User the report is about (game host, message sender, reel owner). */
  reportedId: string;
  /** Shown in the dialog title, e.g. a display name or game title. */
  subjectLabel: string;
  gameId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  reelId?: string | null;
  /** The network post a "post" report is about; the database names its author as the reported user. */
  postId?: string | null;
};

const TITLES: Record<ReportSubjectType, string> = {
  user: "Report",
  game: "Report game",
  message: "Report message",
  reel: "Report highlight",
  payment: "Report a payment problem",
  post: "Report post",
};

export function ReportDialog({
  open,
  onOpenChange,
  subjectType,
  reportedId,
  subjectLabel,
  gameId,
  conversationId,
  messageId,
  reelId,
  postId,
}: Props) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const reasons = reasonsFor(subjectType);

  async function submit() {
    if (!reason) return;
    setSubmitting(true);
    try {
      if (subjectType === "post") {
        // report_post checks the post, the reporter and the author itself; nothing is written directly.
        if (!postId) throw new Error("Couldn't submit your report. Please try again.");
        await reportPost(postId, reason, details);
      } else {
        await submitReport({
          subjectType,
          reportedId,
          reason,
          details,
          gameId,
          conversationId,
          messageId,
          reelId,
        });
      }
      toast.success("Report submitted. Our moderators will review it.");
      onOpenChange(false);
      setReason(null);
      setDetails("");
    } catch (e: unknown) {
      // submitReport's own sentences show as they are; anything else never shows raw (WP 4.0).
      const text = errorText(e);
      toast.error(
        text && REPORT_OWN_MESSAGES.has(text)
          ? text
          : userErrorMessage(e, "Couldn't submit your report. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {subjectType === "user" ? `Report ${subjectLabel}` : TITLES[subjectType]}
          </DialogTitle>
          <DialogDescription>
            {subjectType === "user"
              ? "Reports are confidential — they are never shared with the person you report."
              : `Reports about “${subjectLabel}” are confidential and reviewed by moderators.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Reason</Label>
            <div className="grid gap-2">
              {reasons.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setReason(r.value)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                    reason === r.value
                      ? "border-foreground bg-secondary font-medium"
                      : "border-border bg-transparent hover:bg-secondary/50"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-details">Additional details (optional)</Label>
            <Textarea
              id="report-details"
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
              placeholder="Share anything a moderator should know…"
              rows={4}
            />
            <p className="text-right text-xs text-muted-foreground">{details.length}/1000</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={!reason || submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

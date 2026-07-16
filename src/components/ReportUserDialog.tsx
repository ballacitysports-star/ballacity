import { useState } from "react";
import { toast } from "sonner";
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
import { REPORT_REASONS, reportUser, type ReportReason } from "@/lib/moderation";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  displayName: string;
};

export function ReportUserDialog({ open, onOpenChange, userId, displayName }: Props) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!reason) return;
    setSubmitting(true);
    try {
      await reportUser(userId, reason, details);
      toast.success("Report submitted. Thanks for keeping the community safe.");
      onOpenChange(false);
      setReason(null);
      setDetails("");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't submit report");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report {displayName}</DialogTitle>
          <DialogDescription>
            Reports are confidential. Choose the reason that best fits.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Reason</Label>
            <div className="grid gap-2">
              {REPORT_REASONS.map((r) => (
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
          <Button
            variant="destructive"
            onClick={submit}
            disabled={!reason || submitting}
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

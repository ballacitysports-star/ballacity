import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Info, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AI_DATA_USE,
  AI_DISCLOSURE_POINTS,
  AI_TRAINING_NOTE,
} from "@/lib/ai-video-privacy";

/** The bullet list + data-use answers, reused by the dialog and the settings page. */
export function AiDisclosureBody({ compact = false }: { compact?: boolean }) {
  return (
    <div className="space-y-4">
      <ul className="space-y-1.5">
        {AI_DISCLOSURE_POINTS.map((p) => (
          <li key={p} className="flex gap-2 text-sm text-muted-foreground">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lime" aria-hidden />
            <span>{p}</span>
          </li>
        ))}
      </ul>

      {!compact && (
        <dl className="space-y-3 rounded-xl border border-border bg-surface p-3">
          {AI_DATA_USE.map((item) => (
            <div key={item.question}>
              <dt className="text-sm font-semibold">{item.question}</dt>
              <dd className="mt-0.5 text-sm text-muted-foreground">{item.answer}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="rounded-xl border border-lime/30 bg-lime/5 p-3">
        <p className="text-sm font-semibold">{AI_TRAINING_NOTE.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{AI_TRAINING_NOTE.body}</p>
      </div>
    </div>
  );
}

/**
 * Shown before the first upload for AI analysis (and any time the user wants to
 * re-read it). Nothing is uploaded until the user continues.
 */
export function AiDisclosureDialog({
  open,
  onOpenChange,
  onContinue,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-lime" aria-hidden />
            Before AI analyzes your clip
          </DialogTitle>
          <DialogDescription>
            Here&apos;s what happens to your video and what the results are worth.
          </DialogDescription>
        </DialogHeader>

        <AiDisclosureBody />

        <div className="mt-2 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onContinue}
            disabled={busy}
            className="w-full rounded-xl bg-lime py-2.5 text-sm font-semibold text-black disabled:opacity-60"
          >
            I understand — choose a clip
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full rounded-xl border border-border py-2.5 text-sm font-medium"
          >
            Not now
          </button>
        </div>
        <Link
          to="/account/ai-privacy"
          className="mt-1 block text-center text-xs font-semibold text-lime underline"
        >
          AI &amp; Video Privacy settings
        </Link>
      </DialogContent>
    </Dialog>
  );
}

/** Always-visible short notice next to the upload button. */
export function AiDisclosureNotice() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Your clip is analyzed by AI. Results are estimates and can be wrong — don&apos;t rely on
          them for medical, safety, recruiting, or employment decisions.
        </span>
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-semibold text-lime underline"
        >
          How AI analysis works
        </button>
        <Link to="/account/ai-privacy" className="text-xs font-semibold text-lime underline">
          AI &amp; Video Privacy
        </Link>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>How AI analysis works</DialogTitle>
            <DialogDescription>Plain-language summary of what we do with your clip.</DialogDescription>
          </DialogHeader>
          <AiDisclosureBody />
        </DialogContent>
      </Dialog>
    </div>
  );
}

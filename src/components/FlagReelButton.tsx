import { useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { REEL_QUALITY_ISSUES, flagReelQuality, type ReelQualityIssue } from "@/lib/moderation";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type Props = { reelId: string; authorId: string };

/** Lets viewers flag a reel whose footage is unusable, from a mobile sheet. */
export function FlagReelButton({ reelId, authorId }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [issue, setIssue] = useState<ReelQualityIssue | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (user?.id === authorId) return null;

  async function submit() {
    if (!issue) return;
    setSending(true);
    try {
      await flagReelQuality(reelId, authorId, issue, note);
      setSent(true);
      setOpen(false);
      toast.success("Thanks — our team will take a look at this clip.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send that report");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (user ? setOpen(true) : toast.error("Sign in to flag a reel"))}
        disabled={sent}
        className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-coral disabled:opacity-60"
      >
        <Flag className="h-3.5 w-3.5" />
        {sent ? "Flagged" : "Flag"}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader className="text-left">
            <SheetTitle>Flag this clip</SheetTitle>
            <SheetDescription>
              Tell us what's wrong with the footage. Reports are private.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-3 space-y-2">
            {REEL_QUALITY_ISSUES.map((i) => (
              <button
                key={i.value}
                type="button"
                onClick={() => setIssue(i.value)}
                className={`flex w-full items-center rounded-xl border px-3 py-3 text-left text-sm font-semibold ${
                  issue === i.value
                    ? "border-lime bg-lime/10 text-lime"
                    : "border-border text-foreground"
                }`}
              >
                {i.label}
              </button>
            ))}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Add a detail (optional)"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!issue || sending}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
            >
              {sending && <Loader2 className="h-4 w-4 animate-spin" />} Send report
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

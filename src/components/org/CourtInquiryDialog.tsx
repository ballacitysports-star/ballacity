import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { submitCourtInquiry } from "@/lib/court-inquiries.functions";
import {
  COURT_TYPES,
  INQUIRY_DURATIONS,
  INQUIRY_SPORTS,
  TIME_SLOTS,
  validateCourtInquiry,
  type CourtType,
  type TimeSlot,
} from "@/lib/court-inquiries";

const fieldCls =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime/60";

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * In-app court inquiry: sport / court type, date, start time, length, party
 * size and notes, sent to the facility's owner and admins.
 */
export function CourtInquiryDialog({
  orgId,
  orgName,
  open,
  onOpenChange,
}: {
  orgId: string;
  orgName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const auth = useAuth();
  const qc = useQueryClient();
  const submit = useServerFn(submitCourtInquiry);
  const [sport, setSport] = useState<string>("Basketball");
  const [courtType, setCourtType] = useState<CourtType>("any");
  const [date, setDate] = useState(todayLocal());
  const [timeSlot, setTimeSlot] = useState<TimeSlot>("evening");
  const [startTime, setStartTime] = useState("18:00");
  const [durationMin, setDurationMin] = useState(120);
  const [playerCount, setPlayerCount] = useState(10);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setDate((d) => d || todayLocal());
  }, [open]);

  const input = {
    orgId,
    sport,
    courtType,
    date,
    timeSlot,
    startTime: timeSlot === "custom" ? startTime : undefined,
    durationMin,
    playerCount,
    notes: notes.trim() || undefined,
  };

  async function onSend() {
    const err = validateCourtInquiry(input);
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      await submit({ data: input });
      toast.success(`Inquiry sent to ${orgName}`);
      qc.invalidateQueries({ queryKey: ["org-court-inquiries", orgId] });
      setNotes("");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send your inquiry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Book a court at {orgName}</DialogTitle>
          <DialogDescription>
            Tell the facility what you need. They&apos;ll reply in your messages.
          </DialogDescription>
        </DialogHeader>

        {!auth.user ? (
          <div className="space-y-3 py-2 text-sm">
            <p className="text-muted-foreground">Sign in to send a court inquiry.</p>
            <Link
              to="/auth"
              search={{ next: "/orgs" }}
              className="inline-flex rounded-full bg-lime px-4 py-2 text-xs font-bold text-primary-foreground"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Sport</span>
                <select
                  value={sport}
                  onChange={(e) => setSport(e.target.value)}
                  className={fieldCls}
                >
                  {INQUIRY_SPORTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Court / area</span>
                <select
                  value={courtType}
                  onChange={(e) => setCourtType(e.target.value as CourtType)}
                  className={fieldCls}
                >
                  {COURT_TYPES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted-foreground">Date</span>
              <input
                type="date"
                value={date}
                min={todayLocal()}
                onChange={(e) => setDate(e.target.value)}
                className={fieldCls}
              />
            </label>
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground">Preferred time</span>
              <div role="group" aria-label="Preferred time" className="flex flex-wrap gap-1.5">
                {TIME_SLOTS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={timeSlot === t.value}
                    onClick={() => setTimeSlot(t.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      timeSlot === t.value
                        ? "border-lime bg-lime text-primary-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.label}
                    {t.hint && timeSlot === t.value ? ` · ${t.hint}` : ""}
                  </button>
                ))}
              </div>
              {timeSlot === "custom" && (
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  aria-label="Start time"
                  className={`${fieldCls} mt-1.5`}
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Length</span>
                <select
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                  className={fieldCls}
                >
                  {INQUIRY_DURATIONS.map((d) => (
                    <option key={d.min} value={d.min}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Players</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={200}
                  value={playerCount}
                  onChange={(e) => setPlayerCount(Number(e.target.value) || 0)}
                  className={fieldCls}
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted-foreground">Notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="e.g. Team practice for 12 players, or a pickup scrimmage"
                className={fieldCls}
              />
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {auth.user && (
            <Button onClick={onSend} disabled={busy}>
              {busy ? "Sending…" : "Send inquiry"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

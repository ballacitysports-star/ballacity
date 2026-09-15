import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  Calendar,
  Clock,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import type { Org } from "@/lib/sample-data";
import { ensureOrgOwnerId } from "@/lib/org-store";
import {
  createTrainerSessionRequest,
  cancelTrainerSessionRequest,
  getMyPendingRequestForTrainer,
  listTrainerBookedSlots,
  type TrainerBookedSlot,
  type TrainerSessionRequest,
} from "@/lib/trainer-requests";
import { useAuth } from "@/hooks/use-auth";
import { resolveDay, fromDateKey, maxHorizonDate, toDateKey } from "@/lib/availability-resolve";
import { DEFAULT_TZ, getBrowserTz, tzShortName, wallTimeToInstant, instantToWall } from "@/lib/tz";
import { Globe } from "lucide-react";
import { NextAvailableList } from "@/components/NextAvailableList";

export type BookPrefill = {
  date?: string;
  startTime?: string;
  venue?: string | null;
  duration?: "30" | "60" | "90";
};

type Mode = "form" | "existing" | "sent";

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const fromMin = (n: number) => {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const fmt12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = (h ?? 0) < 12 ? "AM" : "PM";
  const hr = (h ?? 0) % 12 || 12;
  return `${hr}:${String(m ?? 0).padStart(2, "0")} ${ampm}`;
};

export function BookSessionSheet({
  org,
  open,
  onOpenChange,
  onStatusChange,
  prefill,
}: {
  org: Org;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onStatusChange?: () => void;
  prefill?: BookPrefill | null;
}) {
  const nav = useNavigate();
  const { user } = useAuth();
  const sessionTypes = useMemo(
    () => org.sessionTypes ?? ["1:1 Coaching", "Group Session", "Assessment"],
    [org.sessionTypes],
  );

  const [sessionType, setSessionType] = useState(sessionTypes[0]);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState<string>(""); // "HH:MM" or ""
  const [duration, setDuration] = useState<"30" | "60" | "90">("60");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<Mode>("form");
  const [existing, setExisting] = useState<TrainerSessionRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bookings, setBookings] = useState<TrainerBookedSlot[]>([]);

  // On open, check for existing request
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    setLoading(true);
    getMyPendingRequestForTrainer(org.id)
      .then((row) => {
        if (cancelled) return;
        if (row && (row.status === "pending" || row.status === "accepted")) {
          setExisting(row);
          setMode("existing");
        } else {
          setExisting(null);
          setMode("form");
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, user, org.id]);

  // Apply prefill when the sheet opens (or prefill changes while open).
  useEffect(() => {
    if (!open || !prefill) return;
    if (prefill.date) setDate(prefill.date);
    if (prefill.startTime) setStartTime(prefill.startTime);
    if (prefill.duration) setDuration(prefill.duration);
  }, [open, prefill]);

  // Load trainer's booked slots when the date changes
  useEffect(() => {
    if (!open || !date || mode !== "form") {
      setBookings([]);
      return;
    }
    let cancelled = false;
    listTrainerBookedSlots(org.id, date)
      .then((rows) => {
        if (!cancelled) setBookings(rows);
      })
      .catch(() => {
        if (!cancelled) setBookings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, date, org.id, mode]);

  const trainerTz = org.timezone || DEFAULT_TZ;
  const viewerTz = useMemo(() => getBrowserTz(), []);
  const differ = trainerTz !== viewerTz;

  // Convert a trainer-local wall time on the selected date into the viewer's
  // wall time. Returns null when either input is missing.
  const toViewerLabel = (hhmm: string): string | null => {
    if (!date || !hhmm) return null;
    const inst = wallTimeToInstant(date, hhmm, trainerTz);
    const w = instantToWall(inst, viewerTz);
    const sameDay = w.dateKey === date;
    const time = `${Number(w.hhmm.split(":")[0]) % 12 || 12}:${w.hhmm.split(":")[1]} ${Number(w.hhmm.split(":")[0]) < 12 ? "AM" : "PM"}`;
    return sameDay ? time : `${time} (${w.dateKey})`;
  };
  const viewerTzShort = tzShortName(date ? fromDateKey(date) : new Date(), viewerTz);
  const trainerTzShort = tzShortName(date ? fromDateKey(date) : new Date(), trainerTz);

  const availWindows = useMemo(() => {
    if (!date) return [];
    return resolveDay(
      fromDateKey(date),
      org.availabilitySlots ?? [],
      org.availabilityOverrides ?? [],
      { rules: org.availabilityRules ?? [] },
    );
  }, [date, org.availabilitySlots, org.availabilityOverrides, org.availabilityRules]);

  const durMin = Number(duration);
  const selWindow = useMemo(() => {
    if (!startTime) return null;
    const s = toMin(startTime);
    return { start: s, end: s + durMin };
  }, [startTime, durMin]);

  const offAvailability = useMemo(() => {
    if (!selWindow || availWindows.length === 0) return false;
    return !availWindows.some(
      (w) => selWindow.start >= toMin(w.start) && selWindow.end <= toMin(w.end),
    );
  }, [selWindow, availWindows]);

  const conflict = useMemo(() => {
    if (!selWindow) return null;
    return (
      bookings.find((b) => {
        const a = toMin(b.start);
        const bEnd = toMin(b.end);
        return selWindow.start < bEnd && selWindow.end > a;
      }) ?? null
    );
  }, [selWindow, bookings]);

  // Suggested chip times: 30-min steps inside availability that fit duration and don't conflict.
  const suggestedTimes = useMemo(() => {
    if (!date || availWindows.length === 0) return [] as string[];
    const out: string[] = [];
    const conflicts = bookings.map((b) => ({ a: toMin(b.start), b: toMin(b.end) }));
    for (const w of availWindows) {
      const ws = toMin(w.start);
      const we = toMin(w.end);
      for (let t = ws; t + durMin <= we; t += 30) {
        const overlaps = conflicts.some((c) => t < c.b && t + durMin > c.a);
        if (!overlaps) out.push(fromMin(t));
      }
    }
    return Array.from(new Set(out)).slice(0, 12);
  }, [date, availWindows, bookings, durMin]);

  // If current start time is invalid after a duration change, keep the value but flag it (user sees the warning).
  useEffect(() => {
    // no-op: warnings handle invalid combos.
  }, [duration]);

  const pickSuggested = () => {
    if (suggestedTimes[0]) setStartTime(suggestedTimes[0]);
  };

  const reset = () => {
    setMode("form");
    setExisting(null);
    setMessage("");
    setDate("");
    setStartTime("");
    setDuration("60");
    setSessionType(sessionTypes[0]);
    setBookings([]);
    setSubmitting(false);
  };

  const canSubmit = useMemo(() => {
    if (!startTime) return true; // time is optional; only conflict-check when set
    return !offAvailability && !conflict;
  }, [startTime, offAvailability, conflict]);

  const submit = async () => {
    if (!user) {
      toast("Sign in to request a session");
      nav({ to: "/auth" });
      return;
    }
    if (startTime && !date) {
      toast.error("Pick a date for your preferred time.");
      return;
    }
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const ownerId = await ensureOrgOwnerId(org.id);
      if (!ownerId) throw new Error("Trainer profile not available. Try again shortly.");
      const row = await createTrainerSessionRequest({
        trainerId: org.id,
        toUserId: ownerId,
        sessionType,
        preferredDate: date || null,
        preferredStartTime: startTime || null,
        durationMinutes: durMin,
        message,
      });
      setExisting(row);
      setMode("sent");
      toast.success(`Request sent to ${org.name}`);
      onStatusChange?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not send request");
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!existing) return;
    setSubmitting(true);
    try {
      await cancelTrainerSessionRequest(existing.id);
      toast.success("Request cancelled");
      onStatusChange?.();
      onOpenChange(false);
      setTimeout(reset, 250);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not cancel request");
    } finally {
      setSubmitting(false);
    }
  };

  const statusMeta = (s: TrainerSessionRequest["status"]) => {
    switch (s) {
      case "pending":
        return {
          label: "Pending",
          cls: "bg-amber-500/15 text-amber-300 border-amber-500/40",
          Icon: Loader2,
        };
      case "accepted":
        return {
          label: "Accepted",
          cls: "bg-lime/15 text-lime border-lime/40",
          Icon: CheckCircle2,
        };
      case "declined":
        return {
          label: "Declined",
          cls: "bg-rose-500/15 text-rose-300 border-rose-500/40",
          Icon: XCircle,
        };
      case "cancelled":
        return {
          label: "Cancelled",
          cls: "bg-muted text-muted-foreground border-border",
          Icon: XCircle,
        };
      case "completed":
        return {
          label: "Completed",
          cls: "bg-lime/15 text-lime border-lime/40",
          Icon: CheckCircle2,
        };
    }
  };

  const disabledReason = !canSubmit
    ? conflict
      ? "This time overlaps another session"
      : "Trainer isn't available at this time"
    : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setTimeout(reset, 250);
      }}
    >
      <SheetContent
        side="bottom"
        className="rounded-t-3xl border-border max-h-[92vh] overflow-y-auto"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-xl">
            {mode === "sent"
              ? "Request sent"
              : mode === "existing"
                ? "Your request"
                : "Book a session"}
          </SheetTitle>
          <SheetDescription>
            {mode === "sent" ? (
              <>
                Your request is on its way to{" "}
                <span className="text-foreground font-semibold">{org.name}</span>. You'll be
                notified when they respond.
              </>
            ) : mode === "existing" && existing ? (
              <>
                You already have a {existing.status} request with{" "}
                <span className="text-foreground font-semibold">{org.name}</span>.
              </>
            ) : (
              <>
                Send a request to <span className="text-foreground font-semibold">{org.name}</span>.
                They'll confirm availability in your inbox.
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="mt-8 flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : mode === "existing" && existing ? (
          <ExistingRequestView row={existing} statusMeta={statusMeta} />
        ) : mode === "sent" && existing ? (
          <ExistingRequestView row={existing} statusMeta={statusMeta} />
        ) : (
          <div className="mt-5 space-y-4">
            {differ && (
              <div className="rounded-2xl border border-lime/30 bg-lime/5 px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
                <Globe className="h-3.5 w-3.5 text-lime shrink-0 mt-0.5" />
                <span>
                  Trainer's schedule is in{" "}
                  <span className="font-semibold text-foreground">
                    {trainerTz.replace(/_/g, " ")} ({trainerTzShort})
                  </span>
                  . Times below are shown in trainer time — we'll also show what that is in your
                  local time ({viewerTzShort}).
                </span>
              </div>
            )}

            {!date && (
              <div>
                <div className="section-eyebrow text-muted-foreground mb-2">Next available</div>
                <NextAvailableList
                  org={org}
                  limit={3}
                  compact
                  onPick={(s) => {
                    setDate(s.dateKey);
                    setStartTime(s.trainerStart ?? s.start);
                  }}
                />
              </div>
            )}

            {/* Conflict / off-availability warning */}
            {selWindow && (conflict || offAvailability) && (
              <div
                role="alert"
                className="rounded-2xl border border-rose-500/50 bg-rose-500/10 p-3 text-sm flex gap-3"
              >
                <AlertTriangle className="h-5 w-5 text-rose-300 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-rose-200">
                    {conflict
                      ? "This time overlaps another session"
                      : "Trainer isn't available at this time"}
                  </div>
                  <p className="mt-1 text-xs text-rose-100/80">
                    You picked{" "}
                    <span className="font-semibold">
                      {fmt12(startTime)}–{fmt12(fromMin(selWindow.end))}
                    </span>
                    {conflict ? (
                      <>
                        {" "}
                        but the trainer already has a{" "}
                        <span className="font-semibold">{conflict.status}</span> booking from{" "}
                        <span className="font-semibold">
                          {fmt12(conflict.start)}–{fmt12(conflict.end)}
                        </span>
                        .
                      </>
                    ) : availWindows.length > 0 ? (
                      <>
                        {" "}
                        but they're only free{" "}
                        <span className="font-semibold">
                          {availWindows.map((w) => `${fmt12(w.start)}–${fmt12(w.end)}`).join(", ")}
                        </span>
                        .
                      </>
                    ) : (
                      <> and they have no availability this day.</>
                    )}
                  </p>
                  {suggestedTimes.length > 0 && (
                    <button
                      type="button"
                      onClick={pickSuggested}
                      className="mt-2 inline-flex items-center rounded-full border border-rose-400/60 bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/25"
                    >
                      Use next free slot: {fmt12(suggestedTimes[0])}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div>
              <div className="section-eyebrow text-muted-foreground mb-2">Session type</div>
              <div className="flex flex-wrap gap-2">
                {sessionTypes.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSessionType(s)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                      sessionType === s
                        ? "border-lime bg-lime/15 text-lime"
                        : "border-border bg-surface text-muted-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="section-eyebrow text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" /> Preferred date
                </span>
                <input
                  type="date"
                  value={date}
                  min={new Date().toISOString().slice(0, 10)}
                  max={toDateKey(maxHorizonDate())}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setStartTime("");
                  }}
                  className="w-full rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-lime"
                />
                {date && availWindows.length === 0 && (
                  <p className="mt-1 text-[11px] text-rose-300">
                    Trainer is not available this day — request anyway or pick another date.
                  </p>
                )}
                {date && availWindows.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Available:{" "}
                    {availWindows.map((w) => `${fmt12(w.start)}–${fmt12(w.end)}`).join(", ")}{" "}
                    <span className="font-semibold text-foreground">{trainerTzShort}</span>
                  </p>
                )}
              </label>
              <div>
                <span className="section-eyebrow text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> Duration
                </span>
                <div className="flex gap-1.5">
                  {(["30", "60", "90"] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDuration(d)}
                      className={`flex-1 rounded-2xl border py-2.5 text-sm font-semibold transition-all ${
                        duration === d
                          ? "border-lime bg-lime/15 text-lime"
                          : "border-border bg-surface text-muted-foreground"
                      }`}
                    >
                      {d}m
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Start time picker */}
            {date && (
              <div>
                <div className="section-eyebrow text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> Start time
                </div>
                {suggestedTimes.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {suggestedTimes.map((t) => {
                      const active = startTime === t;
                      const viewerLbl = differ ? toViewerLabel(t) : null;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setStartTime(t)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all flex flex-col items-center leading-tight ${
                            active
                              ? "border-lime bg-lime/15 text-lime"
                              : "border-border bg-surface text-muted-foreground"
                          }`}
                        >
                          <span>{fmt12(t)}</span>
                          {viewerLbl && (
                            <span className="text-[9px] font-normal opacity-70">
                              {viewerLbl} {viewerTzShort}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground mb-1.5">
                    No pre-computed slots — pick a custom time below.
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="time"
                    value={startTime}
                    step={900}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="flex-1 rounded-2xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-lime"
                  />
                  {startTime && (
                    <button
                      type="button"
                      onClick={() => setStartTime("")}
                      className="text-xs font-semibold text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {differ && startTime && toViewerLabel(startTime) && (
                  <p className="mt-1.5 text-[11px] text-lime/90">
                    In your time:{" "}
                    <span className="font-semibold">
                      {toViewerLabel(startTime)} {viewerTzShort}
                    </span>
                  </p>
                )}
                {bookings.length > 0 && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Already booked:{" "}
                    {bookings.map((b) => `${fmt12(b.start)}–${fmt12(b.end)}`).join(", ")}
                  </p>
                )}
              </div>
            )}

            <label className="block">
              <span className="section-eyebrow text-muted-foreground mb-1.5 flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5" /> Message
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 500))}
                placeholder="Share your goals, current level, and anything else that helps them prep."
                rows={4}
                className="w-full rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-lime resize-none"
              />
              <span className="mt-1 block text-right text-[10px] text-muted-foreground">
                {message.length}/500
              </span>
            </label>

            {org.ratePerHour ? (
              <div className="rounded-2xl border border-border bg-surface p-3 text-sm">
                Estimated cost:{" "}
                <span className="font-bold text-foreground">
                  ${Math.round((org.ratePerHour * durMin) / 60)}
                </span>{" "}
                <span className="text-muted-foreground">
                  (${org.ratePerHour}/hr · {duration} min)
                </span>
              </div>
            ) : null}
          </div>
        )}

        <SheetFooter className="mt-5 gap-2 flex-row">
          {mode === "existing" && existing ? (
            <>
              <button
                onClick={() => onOpenChange(false)}
                className="flex-1 rounded-full border border-border bg-surface px-4 py-3 text-sm font-bold"
              >
                Close
              </button>
              {existing.status === "pending" ? (
                <button
                  onClick={cancel}
                  disabled={submitting}
                  className="flex-1 rounded-full border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-300 disabled:opacity-60"
                >
                  {submitting ? "Cancelling…" : "Cancel request"}
                </button>
              ) : (
                <button
                  onClick={() => {
                    onOpenChange(false);
                    nav({ to: "/messages" });
                  }}
                  className="flex-1 rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground glow-lime"
                >
                  Open chat
                </button>
              )}
            </>
          ) : mode === "sent" ? (
            <>
              <button
                onClick={() => onOpenChange(false)}
                className="flex-1 rounded-full border border-border bg-surface px-4 py-3 text-sm font-bold"
              >
                Done
              </button>
              <button
                onClick={() => {
                  onOpenChange(false);
                  nav({ to: "/messages" });
                }}
                className="flex-1 rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground glow-lime"
              >
                Message trainer
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onOpenChange(false)}
                className="flex-1 rounded-full border border-border bg-surface px-4 py-3 text-sm font-bold"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting || !canSubmit}
                aria-disabled={submitting || !canSubmit}
                title={disabledReason}
                className="flex-1 rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground glow-lime disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? "Sending…" : !canSubmit ? "Pick another time" : "Send request"}
              </button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ExistingRequestView({
  row,
  statusMeta,
}: {
  row: TrainerSessionRequest;
  statusMeta: (s: TrainerSessionRequest["status"]) => {
    label: string;
    cls: string;
    Icon: typeof CheckCircle2;
  };
}) {
  const meta = statusMeta(row.status);
  const dateLabel = row.preferred_date
    ? new Date(row.preferred_date).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;
  const timeLabel = row.preferred_start_time
    ? `${fmt12(row.preferred_start_time.slice(0, 5))}–${fmt12(
        fromMin(toMin(row.preferred_start_time.slice(0, 5)) + row.duration_minutes),
      )}`
    : null;
  return (
    <div className="mt-5 space-y-3">
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${meta.cls}`}
      >
        <meta.Icon className={`h-3.5 w-3.5 ${row.status === "pending" ? "animate-spin" : ""}`} />
        {meta.label}
      </div>
      <div className="rounded-2xl border border-border bg-surface p-4 space-y-2 text-sm">
        <Row label="Session" value={row.session_type} />
        <Row label="Duration" value={`${row.duration_minutes} min`} />
        {dateLabel ? (
          <Row
            label="Preferred date"
            value={timeLabel ? `${dateLabel} · ${timeLabel}` : dateLabel}
          />
        ) : null}
        {row.message ? <Row label="Your note" value={row.message} multiline /> : null}
        {row.responder_note ? (
          <Row label="Trainer note" value={row.responder_note} multiline />
        ) : null}
        <Row
          label="Sent"
          value={new Date(row.created_at).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        />
      </div>
    </div>
  );
}

function Row({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={multiline ? "" : "flex items-baseline justify-between gap-3"}>
      <div className="section-eyebrow text-muted-foreground">{label}</div>
      <div
        className={`text-sm text-foreground ${multiline ? "mt-1 whitespace-pre-wrap" : "text-right"}`}
      >
        {value}
      </div>
    </div>
  );
}

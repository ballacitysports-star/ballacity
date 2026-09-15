import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X, Plus, Ban, RotateCcw } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { validateSlots, validateOverrides, type Slot } from "@/lib/availability-slots";
import {
  type DayOverride,
  type OverrideWindow,
  type ResolvedWindow,
  fromDateKey,
  maxHorizonDate,
  resolveDay,
  toDateKey,
  weekdayOf,
} from "@/lib/availability-resolve";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export type AvailabilityCalendarProps = {
  weekly: Slot[];
  overrides: DayOverride[];
  venues: string[]; // verified venue addresses
  primaryVenue?: string | null;
  /** IANA timezone this schedule is anchored to. Used only for a subtle header label. */
  timezone?: string;
  onWeeklyChange: (next: Slot[]) => void;
  onOverridesChange: (next: DayOverride[]) => void;
};

export function AvailabilityCalendar({
  weekly,
  overrides,
  venues,
  primaryVenue,
  timezone,
  onWeeklyChange,
  onOverridesChange,
}: AvailabilityCalendarProps) {
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const horizon = useMemo(() => maxHorizonDate(today), [today]);
  const [cursor, setCursor] = useState<Date>(startOfMonth(today));
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [showWeekly, setShowWeekly] = useState(false);

  const monthStart = startOfMonth(cursor);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay()); // back to Sunday
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  const canGoBack = monthStart > startOfMonth(today);
  const canGoNext = monthStart < startOfMonth(horizon);

  const weeklyError = useMemo(() => validateSlots(weekly), [weekly]);
  const overridesError = useMemo(
    () => validateOverrides(overrides, new Set(venues.map((v) => v.trim().toLowerCase()))),
    [overrides, venues],
  );

  const currentOverride = editingDate
    ? (overrides.find((o) => o.date === editingDate) ?? null)
    : null;
  const editingWindows: OverrideWindow[] = currentOverride?.windows ?? [];

  function updateOverride(date: string, patch: Partial<DayOverride> | null) {
    const idx = overrides.findIndex((o) => o.date === date);
    if (patch === null) {
      if (idx === -1) return;
      const next = overrides.slice();
      next.splice(idx, 1);
      onOverridesChange(next);
      return;
    }
    const base: DayOverride = idx === -1 ? { date, windows: [] } : overrides[idx];
    const merged = { ...base, ...patch, date };
    if (!merged.closed && (!merged.windows || merged.windows.length === 0)) {
      // No content — remove
      if (idx !== -1) {
        const next = overrides.slice();
        next.splice(idx, 1);
        onOverridesChange(next);
      }
      return;
    }
    const next = overrides.slice();
    if (idx === -1) next.push(merged);
    else next[idx] = merged;
    onOverridesChange(next);
  }

  function setEditingWindows(next: OverrideWindow[]) {
    if (!editingDate) return;
    updateOverride(editingDate, { closed: false, windows: next });
  }

  return (
    <div className="space-y-3">
      {/* Month navigator */}
      <div className="flex items-center justify-between rounded-2xl border border-border bg-surface px-3 py-2">
        <button
          type="button"
          onClick={() => canGoBack && setCursor(addMonths(cursor, -1))}
          disabled={!canGoBack}
          className="rounded-full p-1.5 text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-bold">
          {cursor.toLocaleString(undefined, { month: "long", year: "numeric" })}
        </div>
        <button
          type="button"
          onClick={() => canGoNext && setCursor(addMonths(cursor, 1))}
          disabled={!canGoNext}
          className="rounded-full p-1.5 text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {timezone && (
        <div className="px-1 text-[11px] text-muted-foreground">
          Times shown in{" "}
          <span className="font-semibold text-foreground">{timezone.replace(/_/g, " ")}</span> —
          this is the timezone attendees will see converted to their local time.
        </div>
      )}

      {overrides.length > 0 && (
        <button
          type="button"
          onClick={() => onOverridesChange([])}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 py-2.5 text-xs font-bold text-muted-foreground transition-colors hover:border-lime hover:text-lime"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to weekly template
          <span className="rounded-full bg-coral/10 px-2 py-0.5 text-[10px] text-coral">
            {overrides.length} override{overrides.length === 1 ? "" : "s"}
          </span>
        </button>
      )}

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-1 px-1 text-center micro-label text-muted-foreground">
        {DAY_LABELS.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const key = toDateKey(d);
          const inMonth = isSameMonth(d, monthStart);
          const past = d < today;
          const beyond = d > horizon;
          const disabled = past || beyond;
          const override = overrides.find((o) => o.date === key);
          const resolved = resolveDay(d, weekly, overrides);
          const closed = override?.closed;
          const hasCustom = !!override && !override.closed && (override.windows?.length ?? 0) > 0;
          const hasAny = resolved.length > 0;
          const baseCls =
            "relative aspect-square rounded-xl border text-xs font-semibold transition-all flex flex-col items-center justify-center gap-0.5";
          const stateCls = disabled
            ? "border-border/30 bg-transparent text-muted-foreground/40 cursor-not-allowed"
            : closed
              ? "border-rose-500/50 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
              : hasCustom
                ? "border-lime bg-lime/15 text-lime hover:bg-lime/25"
                : hasAny
                  ? "border-lime/40 bg-lime/5 text-foreground hover:border-lime"
                  : "border-border bg-surface text-muted-foreground hover:border-lime/60";
          return (
            <button
              type="button"
              key={key}
              disabled={disabled}
              onClick={() => setEditingDate(key)}
              className={`${baseCls} ${stateCls} ${!inMonth ? "opacity-40" : ""}`}
            >
              <span>{d.getDate()}</span>
              {!disabled &&
                (closed ? (
                  <Ban className="h-2.5 w-2.5" />
                ) : hasAny ? (
                  <span className="h-1 w-1 rounded-full bg-lime" />
                ) : null)}
            </button>
          );
        })}
      </div>

      {overridesError && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {overridesError.message}
        </p>
      )}

      {/* Weekly base accordion */}
      <div className="rounded-2xl border border-border bg-surface">
        <button
          type="button"
          onClick={() => setShowWeekly((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-bold"
        >
          <span>Weekly pattern ({weekly.length})</span>
          <span className="text-xs font-semibold text-muted-foreground">
            {showWeekly ? "Hide" : "Edit"}
          </span>
        </button>
        {showWeekly && (
          <div className="border-t border-border p-3 space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Repeating windows applied every week. Use the calendar above to override specific
              dates.
            </p>
            {weekly.length === 0 && (
              <p className="text-xs text-muted-foreground">No recurring windows yet.</p>
            )}
            {weekly.map((slot, i) => {
              const rowError = weeklyError?.index === i ? weeklyError : null;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <select
                      value={slot.day}
                      onChange={(e) =>
                        onWeeklyChange(
                          weekly.map((s, j) =>
                            j === i ? { ...s, day: e.target.value as Slot["day"] } : s,
                          ),
                        )
                      }
                      className={`rounded-2xl border bg-background px-2 py-2 text-xs outline-none focus:border-lime ${rowError ? "border-red-500" : "border-border"}`}
                    >
                      <option value="mon">Mon</option>
                      <option value="tue">Tue</option>
                      <option value="wed">Wed</option>
                      <option value="thu">Thu</option>
                      <option value="fri">Fri</option>
                      <option value="sat">Sat</option>
                      <option value="sun">Sun</option>
                    </select>
                    <input
                      type="time"
                      value={slot.start}
                      onChange={(e) =>
                        onWeeklyChange(
                          weekly.map((s, j) => (j === i ? { ...s, start: e.target.value } : s)),
                        )
                      }
                      className={`flex-1 rounded-2xl border bg-background px-2 py-2 text-xs outline-none focus:border-lime ${rowError ? "border-red-500" : "border-border"}`}
                    />
                    <span className="text-xs text-muted-foreground">–</span>
                    <input
                      type="time"
                      value={slot.end}
                      onChange={(e) =>
                        onWeeklyChange(
                          weekly.map((s, j) => (j === i ? { ...s, end: e.target.value } : s)),
                        )
                      }
                      className={`flex-1 rounded-2xl border bg-background px-2 py-2 text-xs outline-none focus:border-lime ${rowError ? "border-red-500" : "border-border"}`}
                    />
                    <button
                      type="button"
                      onClick={() => onWeeklyChange(weekly.filter((_, j) => j !== i))}
                      className="rounded-full p-1.5 text-muted-foreground hover:bg-background"
                      aria-label="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {venues.length > 0 && (
                    <select
                      value={slot.venue ?? ""}
                      onChange={(e) =>
                        onWeeklyChange(
                          weekly.map((s, j) =>
                            j === i ? { ...s, venue: e.target.value || undefined } : s,
                          ),
                        )
                      }
                      className="w-full rounded-2xl border border-border bg-background px-2 py-2 text-xs outline-none focus:border-lime"
                    >
                      <option value="">Any venue</option>
                      {venues.map((v) => (
                        <option key={v} value={v}>
                          {primaryVenue?.trim() === v.trim() ? "★ " : ""}
                          {v}
                        </option>
                      ))}
                    </select>
                  )}
                  {rowError && <p className="text-[11px] text-rose-400">{rowError.message}</p>}
                </div>
              );
            })}
            <button
              type="button"
              disabled={!!weeklyError}
              onClick={() =>
                onWeeklyChange([
                  ...weekly,
                  { day: "mon", start: "17:00", end: "19:00", venue: primaryVenue ?? undefined },
                ])
              }
              className="inline-flex items-center gap-1.5 rounded-2xl border border-dashed border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:border-lime disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add recurring window
            </button>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 px-1 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-lime" /> Available
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-lime bg-lime/20" />
          Custom day
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-rose-500/60 bg-rose-500/20" />
          Closed
        </span>
      </div>

      {/* Day editor sheet */}
      <Sheet open={!!editingDate} onOpenChange={(v) => !v && setEditingDate(null)}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl border-border max-h-[92vh] overflow-y-auto"
        >
          {editingDate && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="font-display text-xl">
                  {fromDateKey(editingDate).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </SheetTitle>
                <SheetDescription>
                  Add custom windows for this date, or mark it closed. Overrides replace your weekly
                  pattern for this day only.
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-3">
                {/* Weekly preview */}
                <DayPreview weekly={weekly} overrides={overrides} dateKey={editingDate} />

                {/* Closed toggle */}
                <button
                  type="button"
                  onClick={() =>
                    currentOverride?.closed
                      ? updateOverride(editingDate, null)
                      : updateOverride(editingDate, { closed: true, windows: [] })
                  }
                  className={`flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-sm font-semibold transition-all ${
                    currentOverride?.closed
                      ? "border-rose-500 bg-rose-500/15 text-rose-300"
                      : "border-border bg-surface text-foreground hover:border-rose-500/60"
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <Ban className="h-4 w-4" />
                    Mark this day closed
                  </span>
                  <span className="section-eyebrow">{currentOverride?.closed ? "On" : "Off"}</span>
                </button>

                {/* Custom windows */}
                {!currentOverride?.closed && (
                  <div className="space-y-2">
                    <div className="section-eyebrow text-muted-foreground">Custom windows</div>
                    {editingWindows.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Add a window to override the weekly pattern for this day.
                      </p>
                    )}
                    {editingWindows.map((w, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <input
                            type="time"
                            value={w.start}
                            onChange={(e) =>
                              setEditingWindows(
                                editingWindows.map((x, j) =>
                                  j === i ? { ...x, start: e.target.value } : x,
                                ),
                              )
                            }
                            className="flex-1 rounded-2xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-lime"
                          />
                          <span className="text-xs text-muted-foreground">–</span>
                          <input
                            type="time"
                            value={w.end}
                            onChange={(e) =>
                              setEditingWindows(
                                editingWindows.map((x, j) =>
                                  j === i ? { ...x, end: e.target.value } : x,
                                ),
                              )
                            }
                            className="flex-1 rounded-2xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-lime"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setEditingWindows(editingWindows.filter((_, j) => j !== i))
                            }
                            className="rounded-full p-2 text-muted-foreground hover:bg-surface"
                            aria-label="Remove"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        {venues.length > 0 && (
                          <select
                            value={w.venue ?? ""}
                            onChange={(e) =>
                              setEditingWindows(
                                editingWindows.map((x, j) =>
                                  j === i ? { ...x, venue: e.target.value || undefined } : x,
                                ),
                              )
                            }
                            className="w-full rounded-2xl border border-border bg-surface px-3 py-2 text-xs outline-none focus:border-lime"
                          >
                            <option value="">Any venue</option>
                            {venues.map((v) => (
                              <option key={v} value={v}>
                                {primaryVenue?.trim() === v.trim() ? "★ " : ""}
                                {v}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        // Suggest a sensible default from the weekly pattern for this day
                        const dow = weekdayOf(fromDateKey(editingDate));
                        const fromWeekly = weekly.find((s) => s.day === dow);
                        const nextWindow: OverrideWindow = fromWeekly
                          ? {
                              start: fromWeekly.start,
                              end: fromWeekly.end,
                              venue: fromWeekly.venue ?? primaryVenue ?? undefined,
                            }
                          : { start: "17:00", end: "19:00", venue: primaryVenue ?? undefined };
                        setEditingWindows([...editingWindows, nextWindow]);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-2xl border border-dashed border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground hover:border-lime"
                    >
                      <Plus className="h-4 w-4" /> Add window
                    </button>
                  </div>
                )}
              </div>

              <SheetFooter className="mt-5 flex-row gap-2">
                {currentOverride && (
                  <button
                    type="button"
                    onClick={() => {
                      updateOverride(editingDate, null);
                      setEditingDate(null);
                    }}
                    className="flex-1 rounded-full border border-border bg-surface px-4 py-3 text-sm font-bold"
                  >
                    Clear override
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditingDate(null)}
                  className="flex-1 rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground glow-lime"
                >
                  Done
                </button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DayPreview({
  weekly,
  overrides,
  dateKey,
}: {
  weekly: Slot[];
  overrides: DayOverride[];
  dateKey: string;
}) {
  const resolved: ResolvedWindow[] = resolveDay(fromDateKey(dateKey), weekly, overrides);
  if (resolved.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
        No availability for this day.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <div className="mb-1 micro-label text-muted-foreground">
        Currently
      </div>
      <ul className="space-y-1">
        {resolved.map((r, i) => (
          <li key={i} className="flex items-center justify-between text-xs">
            <span className="font-semibold">
              {r.start} – {r.end}
            </span>
            <span className="text-muted-foreground">
              {r.source === "override" ? "Custom" : "Weekly"}
              {r.venue ? ` · ${r.venue}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

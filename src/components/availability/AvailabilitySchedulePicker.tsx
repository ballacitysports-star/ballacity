import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Repeat,
  Scissors,
  SkipForward,
  Trash2,
  X,
} from "lucide-react";
import {
  MAX_SLOTS,
  TIME_PRESETS,
  WEEKDAY_LABELS,
  fmtShortDate,
  fromDateKey,
  isDateSlot,
  normalizeSlots,
  summarizeSlots,
  toDateKey,
  type TimeSlot,
} from "@/lib/availability-timeslots";
import {
  CONFLICT_KIND_LABEL,
  describeConflict,
  dropOverlappingSlots,
  findSelfOverlaps,
  findSlotConflicts,
  suggestSlotFixes,
  type BusyBlock,
  type SlotFix,
} from "@/lib/availability-conflicts";

const DEFAULT_START = "18:00";
const DEFAULT_END = "20:00";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/**
 * Pick multiple individual dates (each with its own time window) or a weekly
 * repeating pattern. Emits a normalized `TimeSlot[]`.
 */
export function AvailabilitySchedulePicker({
  value,
  onChange,
  busy = [],
}: {
  value: TimeSlot[];
  onChange: (slots: TimeSlot[]) => void;
  /** Times the player is already committed to — used for conflict warnings. */
  busy?: BusyBlock[];
}) {
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const [mode, setMode] = useState<"dates" | "weekly">(() =>
    value.some((s) => !isDateSlot(s)) && !value.some(isDateSlot) ? "weekly" : "dates",
  );
  const [cursor, setCursor] = useState<Date>(startOfMonth(today));

  const conflicts = useMemo(() => findSlotConflicts(value, busy), [value, busy]);
  const conflictBySlot = useMemo(
    () => new Map(conflicts.map((c) => [c.slotIndex, c])),
    [conflicts],
  );
  const selfOverlaps = useMemo(() => new Set(findSelfOverlaps(value)), [value]);
  const busyByDate = useMemo(() => {
    const m = new Map<string, BusyBlock[]>();
    for (const b of busy) {
      if (!m.has(b.date)) m.set(b.date, []);
      m.get(b.date)!.push(b);
    }
    return m;
  }, [busy]);

  const dateSlots = value.filter(isDateSlot);
  const weekSlots = value.filter((s) => !isDateSlot(s)) as Extract<TimeSlot, { weekday: number }>[];

  const commit = (next: TimeSlot[]) => onChange(normalizeSlots(next));

  const toggleDate = (key: string) => {
    const has = dateSlots.some((s) => s.date === key);
    if (has) {
      commit(value.filter((s) => !(isDateSlot(s) && s.date === key)));
    } else {
      if (value.length >= MAX_SLOTS) return;
      const last = dateSlots[dateSlots.length - 1];
      commit([
        ...value,
        { date: key, start: last?.start ?? DEFAULT_START, end: last?.end ?? DEFAULT_END },
      ]);
    }
  };

  const toggleWeekday = (w: number) => {
    const has = weekSlots.some((s) => s.weekday === w);
    if (has) {
      commit(value.filter((s) => isDateSlot(s) || s.weekday !== w));
    } else {
      if (value.length >= MAX_SLOTS) return;
      const last = weekSlots[weekSlots.length - 1];
      commit([
        ...value,
        { weekday: w, start: last?.start ?? DEFAULT_START, end: last?.end ?? DEFAULT_END },
      ]);
    }
  };

  const patchSlot = (index: number, patch: Partial<{ start: string; end: string }>) => {
    const next = value.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(next as TimeSlot[]);
  };

  /** Apply a one-tap conflict fix to a single row. */
  const applyFix = (index: number, fix: SlotFix) => {
    if (fix.id === "remove" || !fix.slot) {
      onChange(value.filter((_, i) => i !== index));
      return;
    }
    commit(value.map((s, i) => (i === index ? fix.slot! : s)));
  };

  const applyToAll = (start: string, end: string) => {
    commit(value.map((s) => ({ ...s, start, end }) as TimeSlot));
  };

  const applyPreset = (start: string, end: string) => {
    if (value.length === 0) return;
    applyToAll(start, end);
  };

  // Calendar grid
  const monthStart = startOfMonth(cursor);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  const canGoBack = monthStart > startOfMonth(today);

  const rows = value
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => (mode === "dates" ? isDateSlot(slot) : !isDateSlot(slot)));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-surface p-1">
        <button
          type="button"
          onClick={() => setMode("dates")}
          className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
            mode === "dates" ? "bg-lime text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          <CalendarDays className="h-3.5 w-3.5" /> Specific dates
        </button>
        <button
          type="button"
          onClick={() => setMode("weekly")}
          className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
            mode === "weekly" ? "bg-lime text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          <Repeat className="h-3.5 w-3.5" /> Repeats weekly
        </button>
      </div>

      {mode === "dates" ? (
        <div className="rounded-2xl border border-border bg-surface p-2">
          <div className="mb-1 flex items-center justify-between">
            <button
              type="button"
              onClick={() => canGoBack && setCursor(addMonths(cursor, -1))}
              disabled={!canGoBack}
              aria-label="Previous month"
              className="rounded-full p-1.5 hover:bg-background disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-sm font-bold">
              {cursor.toLocaleString(undefined, { month: "long", year: "numeric" })}
            </div>
            <button
              type="button"
              onClick={() => setCursor(addMonths(cursor, 1))}
              aria-label="Next month"
              className="rounded-full p-1.5 hover:bg-background"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 px-1 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {WEEKDAY_LABELS.map((l) => (
              <div key={l}>{l}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((d) => {
              const key = toDateKey(d);
              const inMonth = d.getMonth() === monthStart.getMonth();
              const past = d < today;
              const selected = dateSlots.some((s) => s.date === key);
              const busyHere = (busyByDate.get(key) ?? []).length > 0;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={past}
                  aria-pressed={selected}
                  aria-label={fmtShortDate(key)}
                  onClick={() => toggleDate(key)}
                  title={busyHere ? "You already have something booked this day" : undefined}
                  className={`relative aspect-square rounded-xl border text-xs font-semibold transition-all ${
                    past
                      ? "cursor-not-allowed border-border/30 text-muted-foreground/40"
                      : selected
                        ? "border-lime bg-lime text-primary-foreground"
                        : "border-border bg-background text-foreground hover:border-lime/60"
                  } ${!inMonth && !past ? "opacity-50" : ""}`}
                >
                  {d.getDate()}
                  {busyHere && !past && (
                    <span
                      aria-hidden
                      className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-amber-400"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_LABELS.map((label, w) => {
            const on = weekSlots.some((s) => s.weekday === w);
            const busyHere = busy.some((b) => fromDateKey(b.date).getDay() === w);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => toggleWeekday(w)}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
                  on
                    ? "border-lime bg-lime text-primary-foreground"
                    : "border-border bg-surface text-muted-foreground hover:border-lime/60"
                }`}
              >
                {label}
                {busyHere && <span className="ml-1 text-amber-400">•</span>}
              </button>
            );
          })}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Set all
            </span>
            {TIME_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.start, p.end)}
                className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-foreground hover:border-lime/60"
              >
                {p.label}
              </button>
            ))}
          </div>

          <ul className="space-y-1.5">
            {rows.map(({ slot, index }) => {
              const conflict = conflictBySlot.get(index);
              const selfOverlap = selfOverlaps.has(index);
              const flagged = !!conflict || selfOverlap;
              return (
                <li
                  key={isDateSlot(slot) ? slot.date : `w${slot.weekday}`}
                  className={`flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 ${
                    flagged ? "border-amber-500/60 bg-amber-500/10" : "border-border bg-surface"
                  }`}
                >
                  <span className="min-w-[86px] flex-1 text-xs font-bold">
                    {isDateSlot(slot) ? fmtShortDate(slot.date) : WEEKDAY_LABELS[slot.weekday]}
                  </span>
                  <input
                    type="time"
                    aria-label="Start time"
                    value={slot.start}
                    step={900}
                    onChange={(e) => patchSlot(index, { start: e.target.value })}
                    className="rounded-xl border border-border bg-background px-2 py-1.5 text-xs [color-scheme:dark]"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input
                    type="time"
                    aria-label="End time"
                    value={slot.end}
                    step={900}
                    onChange={(e) => patchSlot(index, { end: e.target.value })}
                    className="rounded-xl border border-border bg-background px-2 py-1.5 text-xs [color-scheme:dark]"
                  />
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                    className="rounded-full p-1.5 text-muted-foreground hover:text-coral"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyToAll(slot.start, slot.end)}
                    className="rounded-full border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:border-lime/60"
                  >
                    Apply to all
                  </button>
                  {flagged && (
                    <div className="w-full space-y-1.5">
                      <p className="flex items-start gap-1.5 text-[11px] font-medium text-amber-300">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          {conflict
                            ? `${CONFLICT_KIND_LABEL[conflict.blocks[0].kind]} — ${describeConflict(conflict)}`
                            : "Overlaps another window you picked."}
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(conflict ? suggestSlotFixes(conflict) : []).map((fix) => (
                          <button
                            key={fix.id}
                            type="button"
                            title={fix.hint}
                            onClick={() => applyFix(index, fix)}
                            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                              fix.id === "remove"
                                ? "border-border text-muted-foreground hover:border-coral hover:text-coral"
                                : "border-amber-400/70 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
                            }`}
                          >
                            {fix.id === "skip" && <SkipForward className="h-3 w-3" />}
                            {fix.id === "shorten" && <Scissors className="h-3 w-3" />}
                            {fix.id === "remove" && <Trash2 className="h-3 w-3" />}
                            {fix.label}
                          </button>
                        ))}
                        {!conflict && selfOverlap && (
                          <button
                            type="button"
                            onClick={() => onChange(value.filter((_, i) => i !== index))}
                            className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-bold text-muted-foreground hover:border-coral hover:text-coral"
                          >
                            <Trash2 className="h-3 w-3" /> Remove
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {(conflicts.length > 0 || selfOverlaps.size > 0) && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-2xl border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-bold">
              {conflicts.length + (selfOverlaps.size > 0 ? 1 : 0)} scheduling conflict
              {conflicts.length + (selfOverlaps.size > 0 ? 1 : 0) === 1 ? "" : "s"}
            </span>{" "}
            — these windows clash with times you already joined, host, or marked unavailable. You
            can still post; players will just see overlapping times.
          </span>
          {selfOverlaps.size > 0 && (
            <button
              type="button"
              onClick={() => onChange(dropOverlappingSlots(value))}
              className="shrink-0 self-center rounded-full border border-amber-400/70 bg-amber-400/10 px-2.5 py-1 text-[11px] font-bold text-amber-200 hover:bg-amber-400/20"
            >
              Remove overlaps
            </button>
          )}
        </div>
      )}
      <div className="flex items-start justify-between gap-2 rounded-2xl border border-border bg-surface/60 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 whitespace-normal break-words">
          {value.length === 0 ? "Pick dates or weekdays, then set times." : summarizeSlots(value)}
        </span>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex shrink-0 items-center gap-1 font-semibold text-muted-foreground hover:text-coral"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}

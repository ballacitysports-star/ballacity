import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import {
  MAX_SLOTS,
  TIME_PRESETS,
  WEEKDAY_LABELS,
  fmtShortDate,
  isDateSlot,
  normalizeSlots,
  summarizeSlots,
  toDateKey,
  type TimeSlot,
} from "@/lib/availability-timeslots";
import {
  CONFLICT_KIND_LABEL,
  describeConflict,
  findSelfOverlaps,
  findSlotConflicts,
  type BusyBlock,
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
  const weekSlots = value.filter((s) => !isDateSlot(s)) as Extract<
    TimeSlot,
    { weekday: number }
  >[];

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
              return (
                <button
                  key={key}
                  type="button"
                  disabled={past}
                  aria-pressed={selected}
                  aria-label={fmtShortDate(key)}
                  onClick={() => toggleDate(key)}
                  className={`aspect-square rounded-xl border text-xs font-semibold transition-all ${
                    past
                      ? "cursor-not-allowed border-border/30 text-muted-foreground/40"
                      : selected
                        ? "border-lime bg-lime text-primary-foreground"
                        : "border-border bg-background text-foreground hover:border-lime/60"
                  } ${!inMonth && !past ? "opacity-50" : ""}`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_LABELS.map((label, w) => {
            const on = weekSlots.some((s) => s.weekday === w);
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
            {rows.map(({ slot, index }) => (
              <li
                key={isDateSlot(slot) ? slot.date : `w${slot.weekday}`}
                className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2"
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
                  onClick={() =>
                    onChange(value.filter((_, i) => i !== index))
                  }
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
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-surface/60 px-3 py-2 text-[11px] text-muted-foreground">
        <span>
          {value.length === 0
            ? "Pick dates or weekdays, then set times."
            : summarizeSlots(value)}
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

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  WEEKDAY_INITIALS,
  addDaysToKey,
  isDateKey,
  monthGridKeys,
  monthLabel,
  weekdayOfKey,
} from "@/lib/datetime";

export type CalendarMode = "single" | "multi" | "range";

/**
 * The one calendar used everywhere: single day, many days, or a drag/tap range.
 * Renders a month grid with keyboard-friendly buttons and no external deps.
 */
export function MultiDateCalendar({
  mode = "single",
  selected,
  rangeStart,
  rangeEnd,
  minKey,
  maxKey,
  onSelect,
  onRangeChange,
  quickActions = true,
}: {
  mode?: CalendarMode;
  /** Selected date keys (single/multi). */
  selected?: string[];
  rangeStart?: string;
  rangeEnd?: string;
  minKey?: string;
  maxKey?: string;
  onSelect?: (key: string) => void;
  onRangeChange?: (start: string, end: string) => void;
  quickActions?: boolean;
}) {
  const anchor = selected?.[0] ?? rangeStart ?? minKey ?? todayLocalKey();
  const [cursor, setCursor] = useState(() => ({
    year: Number(anchor.slice(0, 4)),
    month: Number(anchor.slice(5, 7)) - 1,
  }));
  const [dragFrom, setDragFrom] = useState<string | null>(null);

  const cells = useMemo(() => monthGridKeys(cursor.year, cursor.month), [cursor]);
  const selectedSet = useMemo(() => new Set(selected ?? []), [selected]);

  const shiftMonth = (delta: number) =>
    setCursor((c) => {
      const m = c.month + delta;
      return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });

  const disabled = (key: string) =>
    (minKey && key < minKey) || (maxKey && key > maxKey) ? true : false;

  const inRange = (key: string) => {
    if (mode !== "range") return false;
    const a = dragFrom ?? rangeStart;
    const b = dragFrom ? dragFrom : rangeEnd;
    if (!a || !b) return false;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return key >= lo && key <= hi;
  };

  const handlePick = (key: string) => {
    if (disabled(key)) return;
    if (mode === "range") {
      if (!dragFrom) {
        setDragFrom(key);
        onRangeChange?.(key, key);
        return;
      }
      const [lo, hi] = dragFrom <= key ? [dragFrom, key] : [key, dragFrom];
      setDragFrom(null);
      onRangeChange?.(lo, hi);
      return;
    }
    onSelect?.(key);
  };

  const monthWeekdayKeys = (match: (w: number) => boolean) =>
    cells.filter((k): k is string => !!k && !disabled(k) && match(weekdayOfKey(k)));

  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => shiftMonth(-1)}
          className="grid size-8 place-items-center rounded-full border border-border text-muted-foreground hover:border-lime/60"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-bold">{monthLabel(cursor.year, cursor.month)}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => shiftMonth(1)}
          className="grid size-8 place-items-center rounded-full border border-border text-muted-foreground hover:border-lime/60"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_INITIALS.map((d, i) => (
          <span key={i} className="text-[10px] font-bold uppercase text-muted-foreground">
            {d}
          </span>
        ))}
        {cells.map((key, i) =>
          key ? (
            <button
              key={key}
              type="button"
              disabled={disabled(key)}
              aria-pressed={selectedSet.has(key) || inRange(key)}
              aria-label={key}
              onClick={() => handlePick(key)}
              onMouseEnter={() => {
                if (mode === "range" && dragFrom && !disabled(key))
                  onRangeChange?.(
                    dragFrom <= key ? dragFrom : key,
                    dragFrom <= key ? key : dragFrom,
                  );
              }}
              className={`aspect-square rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-25 ${
                selectedSet.has(key) || inRange(key)
                  ? "bg-lime text-primary-foreground"
                  : "text-foreground hover:bg-background"
              }`}
            >
              {Number(key.slice(8, 10))}
            </button>
          ) : (
            <span key={`pad-${i}`} />
          ),
        )}
      </div>

      {quickActions && mode === "multi" && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            { label: "All weekends", match: (w: number) => w === 0 || w === 6 },
            { label: "All weekdays", match: (w: number) => w > 0 && w < 6 },
          ].map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => monthWeekdayKeys(q.match).forEach((k) => onSelect?.(k))}
              className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-muted-foreground hover:border-lime/60"
            >
              {q.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function todayLocalKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export { addDaysToKey, isDateKey };

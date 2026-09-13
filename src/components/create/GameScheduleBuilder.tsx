import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import {
  DEFAULT_GAME_TIME,
  MAX_SCHEDULE_DAYS,
  applyTimeToAll,
  defaultEndTime,
  formatScheduleSummary,
  formatShortDate,
  fromDateKey,
  isWeekday,
  isWeekend,
  monthDatesMatching,
  monthGrid,
  normalizeSchedule,
  setScheduleAllDay,
  setScheduleEndTime,
  setScheduleTime,
  toDateKey,
  toggleScheduleDate,
  todayKey,
  type ScheduleEntry,
} from "@/lib/game-schedule";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Pick any set of days, each with its own start time. One game per day.
 */
export function GameScheduleBuilder({
  value,
  onChange,
}: {
  value: ScheduleEntry[];
  onChange: (next: ScheduleEntry[]) => void;
}) {
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const minKey = todayKey(today);
  const [cursor, setCursor] = useState<Date>(startOfMonth(today));
  const cells = useMemo(() => monthGrid(cursor), [cursor]);
  const rows = normalizeSchedule(value);
  const last = rows[rows.length - 1];
  const fallback = {
    time: last?.time ?? DEFAULT_GAME_TIME,
    endTime: last?.endTime ?? defaultEndTime(last?.time ?? DEFAULT_GAME_TIME),
    allDay: last?.allDay ?? false,
  };
  const canGoBack = startOfMonth(cursor) > startOfMonth(today);

  const addMany = (dates: string[]) => {
    let next = value;
    for (const d of dates) {
      if (next.some((e) => e.date === d)) continue;
      next = toggleScheduleDate(next, d, fallback);
    }
    onChange(normalizeSchedule(next));
  };

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={!canGoBack}
          aria-label="Previous month"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="rounded-full border border-border p-1.5 text-muted-foreground disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-sm font-bold">
          {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="rounded-full border border-border p-1.5 text-muted-foreground"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {DOW.map((d, i) => (
          <span key={i} className="text-[10px] font-bold uppercase text-muted-foreground">
            {d}
          </span>
        ))}
        {cells.map((key, i) => {
          if (!key) return <span key={`p${i}`} />;
          const past = key < minKey;
          const selected = rows.some((e) => e.date === key);
          return (
            <button
              key={key}
              type="button"
              disabled={past}
              aria-pressed={selected}
              aria-label={formatShortDate(key)}
              onClick={() => onChange(toggleScheduleDate(value, key, fallback))}
              className={`h-8 rounded-lg text-xs font-semibold transition-colors ${
                selected
                  ? "bg-lime text-primary-foreground"
                  : past
                    ? "text-muted-foreground/40"
                    : "border border-border bg-background text-foreground hover:border-lime/60"
              }`}
            >
              {fromDateKey(key).getDate()}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="micro-label text-muted-foreground">
          Quick add
        </span>
        <button
          type="button"
          onClick={() => addMany(monthDatesMatching(cursor, isWeekday, today))}
          className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold hover:border-lime/60"
        >
          Weekdays
        </button>
        <button
          type="button"
          onClick={() => addMany(monthDatesMatching(cursor, isWeekend, today))}
          className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold hover:border-lime/60"
        >
          Weekends
        </button>
        {rows.length > 1 && (
          <button
            type="button"
            onClick={() => onChange(applyTimeToAll(value, rows[0]!))}
            className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold hover:border-lime/60"
          >
            Same hours for every day
          </button>
        )}
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:border-coral/60 hover:text-coral"
          >
            Clear
          </button>
        )}
      </div>

      {rows.length > 0 && (
        <ul className="space-y-1.5">
          {rows.map((e) => (
            <li
              key={e.date}
              className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background px-3 py-2"
            >
              <span className="min-w-[92px] flex-1 text-xs font-bold">
                {formatShortDate(e.date)}
              </span>
              {!e.allDay && (
                <>
                  <input
                    type="time"
                    aria-label={`Start time on ${formatShortDate(e.date)}`}
                    value={e.time}
                    step={900}
                    onChange={(ev) => onChange(setScheduleTime(value, e.date, ev.target.value))}
                    className="rounded-xl border border-border bg-surface px-2 py-1.5 text-xs [color-scheme:dark]"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input
                    type="time"
                    aria-label={`End time on ${formatShortDate(e.date)}`}
                    value={e.endTime ?? defaultEndTime(e.time)}
                    step={900}
                    onChange={(ev) => onChange(setScheduleEndTime(value, e.date, ev.target.value))}
                    className="rounded-xl border border-border bg-surface px-2 py-1.5 text-xs [color-scheme:dark]"
                  />
                </>
              )}
              <label className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                <input
                  type="checkbox"
                  aria-label={`All day on ${formatShortDate(e.date)}`}
                  checked={!!e.allDay}
                  onChange={(ev) => onChange(setScheduleAllDay(value, e.date, ev.target.checked))}
                  className="h-3.5 w-3.5 accent-lime"
                />
                All day
              </label>
              <button
                type="button"
                aria-label={`Remove ${formatShortDate(e.date)}`}
                onClick={() => onChange(toggleScheduleDate(value, e.date, fallback))}
                className="rounded-full p-1.5 text-muted-foreground hover:text-coral"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-muted-foreground">{formatScheduleSummary(rows)}</p>
      {rows.length >= MAX_SCHEDULE_DAYS && (
        <p className="text-[11px] font-semibold text-amber-300">
          That's the {MAX_SCHEDULE_DAYS}-day maximum.
        </p>
      )}
    </div>
  );
}

export { toDateKey };

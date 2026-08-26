import {
  formatWhenRange,
  setRangeDuration,
  todayKey,
  validateWhenRange,
  whenRangeDurationMin,
  type WhenRange,
} from "@/lib/game-schedule";

const LENGTH_PRESETS = [
  { label: "1h", min: 60 },
  { label: "1h 30m", min: 90 },
  { label: "2h", min: 120 },
  { label: "3h", min: 180 },
];

const inputCls =
  "w-full rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-lime [color-scheme:dark]";

/**
 * One start → end window. The end may land on a later day, and "All day"
 * drops the clock while keeping the date span.
 */
export function DateTimeRangeFields({
  value,
  onChange,
}: {
  value: WhenRange;
  onChange: (next: WhenRange) => void;
}) {
  const min = todayKey();
  const check = validateWhenRange(value);
  const lengthMin = whenRangeDurationMin(value);

  const setStartDate = (startDate: string) => {
    const shiftEnd = value.endDate < startDate;
    onChange({ ...value, startDate, endDate: shiftEnd ? startDate : value.endDate });
  };

  const setStartTime = (startTime: string) => {
    // Keep the current length when the start moves.
    onChange(setRangeDuration({ ...value, startTime }, lengthMin));
  };

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">All day</span>
        <button
          type="button"
          role="switch"
          aria-checked={value.allDay}
          aria-label="Toggle all-day event"
          onClick={() => onChange({ ...value, allDay: !value.allDay })}
          className={`relative h-6 w-10 rounded-full transition-colors ${
            value.allDay ? "bg-lime" : "bg-secondary"
          }`}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all"
            style={{ left: value.allDay ? "calc(100% - 1.375rem)" : "0.125rem" }}
          />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Starts
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              type="date"
              aria-label="Start date"
              min={min}
              value={value.startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputCls}
            />
            {!value.allDay && (
              <input
                type="time"
                aria-label="Start time"
                step={900}
                value={value.startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={inputCls}
              />
            )}
          </div>
        </div>

        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Ends
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              type="date"
              aria-label="End date"
              min={value.startDate || min}
              value={value.endDate}
              onChange={(e) => onChange({ ...value, endDate: e.target.value })}
              className={inputCls}
            />
            {!value.allDay && (
              <input
                type="time"
                aria-label="End time"
                step={900}
                value={value.endTime}
                onChange={(e) => onChange({ ...value, endTime: e.target.value })}
                className={inputCls}
              />
            )}
          </div>
        </div>
      </div>

      {!value.allDay && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Length
          </span>
          {LENGTH_PRESETS.map((p) => (
            <button
              key={p.min}
              type="button"
              aria-pressed={lengthMin === p.min}
              onClick={() => onChange(setRangeDuration(value, p.min))}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                lengthMin === p.min
                  ? "border-lime bg-lime text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-lime/60"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <p className={`text-[11px] ${check.ok ? "text-muted-foreground" : "font-semibold text-coral"}`}>
        {check.ok ? formatWhenRange(value) : check.error}
      </p>
    </div>
  );
}

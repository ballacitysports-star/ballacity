import { useState } from "react";
import {
  addDaysToKey,
  formatTime,
  formatWhenRange,
  friendlyDayLabel,
  nextWeekdayKey,
  setRangeDuration,
  todayKey,
  validateWhenRange,
  weekdayLabel,
  type WhenRange,
} from "@/lib/game-schedule";

const LENGTH_PRESETS = [
  { label: "1h", min: 60 },
  { label: "1h 30m", min: 90 },
  { label: "2h", min: 120 },
  { label: "3h", min: 180 },
];

const inputCls =
  "rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-lime [color-scheme:dark]";

function Chip({
  active,
  onClick,
  children,
  ariaLabel,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={!!active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
        active
          ? "border-lime bg-lime text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-lime/60"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * One start → end window, presented as: pick a day, pick a start, pick a length.
 * End time, end date and all-day details stay tucked away until needed.
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
  const lengthMin = (() => {
    const d = new Date(`${value.endDate}T${value.endTime}:00`).getTime();
    const s = new Date(`${value.startDate}T${value.startTime}:00`).getTime();
    return Number.isFinite(d - s) && d > s ? Math.round((d - s) / 60000) : 0;
  })();

  const spansDays = value.endDate !== value.startDate;
  const isPreset = LENGTH_PRESETS.some((p) => p.min === lengthMin);
  const [showEndDate, setShowEndDate] = useState(spansDays);
  const [showEndTime, setShowEndTime] = useState(!isPreset && !value.allDay);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const dayChips = [
    { key: min, label: "Today" },
    { key: addDaysToKey(min, 1), label: "Tomorrow" },
    { key: nextWeekdayKey(6), label: weekdayLabel(nextWeekdayKey(6)) },
  ].filter((c, i, arr) => arr.findIndex((x) => x.key === c.key) === i);

  const setStartDate = (startDate: string) => {
    const dayShift = spansDays ? 1 : 0;
    onChange({ ...value, startDate, endDate: addDaysToKey(startDate, dayShift) });
  };

  const setStartTime = (startTime: string) => {
    onChange(setRangeDuration({ ...value, startTime }, lengthMin || 90));
  };

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-surface p-3">
      {/* Day */}
      <div>
        <span className="section-eyebrow text-muted-foreground">Day</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {dayChips.map((c) => (
            <Chip
              key={c.key}
              active={value.startDate === c.key && !showDatePicker}
              onClick={() => {
                setShowDatePicker(false);
                setStartDate(c.key);
              }}
            >
              {c.label}
            </Chip>
          ))}
          <Chip
            active={showDatePicker}
            onClick={() => setShowDatePicker((v) => !v)}
            ariaLabel="Pick another date"
          >
            Pick date
          </Chip>
        </div>
        {(showDatePicker || !dayChips.some((c) => c.key === value.startDate)) && (
          <input
            type="date"
            aria-label="Start date"
            min={min}
            value={value.startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={`mt-2 w-full ${inputCls}`}
          />
        )}
      </div>

      {/* Time */}
      {!value.allDay && (
        <div>
          <span className="section-eyebrow text-muted-foreground">Starts at</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              type="time"
              aria-label="Start time"
              step={900}
              value={value.startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={`w-[7.5rem] ${inputCls}`}
            />
            {showEndTime ? (
              <>
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  type="time"
                  aria-label="End time"
                  step={900}
                  value={value.endTime}
                  onChange={(e) => onChange({ ...value, endTime: e.target.value })}
                  className={`w-[7.5rem] ${inputCls}`}
                />
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowEndTime(true)}
                className="text-xs font-semibold text-muted-foreground underline decoration-dotted"
              >
                ends {formatTime(value.endTime)}
              </button>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Length
            </span>
            {LENGTH_PRESETS.map((p) => (
              <Chip
                key={p.min}
                active={lengthMin === p.min && !showEndTime}
                onClick={() => {
                  setShowEndTime(false);
                  setShowEndDate(false);
                  onChange(setRangeDuration(value, p.min));
                }}
              >
                {p.label}
              </Chip>
            ))}
            <Chip active={showEndTime} onClick={() => setShowEndTime(true)}>
              Custom
            </Chip>
          </div>
        </div>
      )}

      {/* Extras */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip
          active={value.allDay}
          ariaLabel="Toggle all-day event"
          onClick={() => onChange({ ...value, allDay: !value.allDay })}
        >
          All day
        </Chip>
        {showEndDate || spansDays ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-muted-foreground">Ends on</span>
            <input
              type="date"
              aria-label="End date"
              min={value.startDate || min}
              value={value.endDate}
              onChange={(e) => onChange({ ...value, endDate: e.target.value })}
              className={inputCls}
            />
            {spansDays && (
              <button
                type="button"
                onClick={() => {
                  setShowEndDate(false);
                  onChange({ ...value, endDate: value.startDate });
                }}
                className="text-[11px] font-semibold text-muted-foreground underline"
              >
                Same day
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setShowEndDate(true);
              setShowEndTime(true);
              onChange({ ...value, endDate: addDaysToKey(value.startDate, 1) });
            }}
            className="text-[11px] font-semibold text-muted-foreground underline decoration-dotted"
          >
            Ends on another day
          </button>
        )}
      </div>

      <p
        className={`text-[11px] ${check.ok ? "text-muted-foreground" : "font-semibold text-coral"}`}
      >
        {check.ok
          ? `${friendlyDayLabel(value.startDate)} · ${formatWhenRange(value)}`
          : check.error}
      </p>
    </div>
  );
}

import { useState } from "react";
import {
  addDaysToKey,
  formatDuration,
  formatTimeKey,
  friendlyDayLabelKey,
  minutesOfTime,
  timeFromMinutes,
  weekdayOfKey,
  WEEKDAY_LABELS,
} from "@/lib/datetime";
import {
  formatWhenRange,
  rangeLengthMin,
  setRangeDuration,
  validateWhenRange,
  type WhenRange,
} from "@/lib/game-schedule";
import { MultiDateCalendar } from "./MultiDateCalendar";
import { TimeField } from "./TimeField";
import { DtChip, DtLabel, DtSummary, dtInputCls } from "./primitives";

const LENGTH_PRESETS = [
  { label: "45m", min: 45 },
  { label: "1h", min: 60 },
  { label: "1h 30m", min: 90 },
  { label: "2h", min: 120 },
  { label: "3h", min: 180 },
];

const ARRIVE_PRESETS = [0, 10, 15, 30];

/**
 * The app-wide start → end picker: pick a day, a start, and a length. End
 * time, end date, all-day, arrive-early and minute precision stay tucked away
 * behind chips until the host needs them.
 */
export function DateTimeRangePicker({
  value,
  onChange,
  todayKey,
  timeZoneLabel,
  arriveEarlyMin,
  onArriveEarlyChange,
  conflictWarning,
}: {
  value: WhenRange;
  onChange: (next: WhenRange) => void;
  todayKey: string;
  /** e.g. "EDT · New York" — shown so hosts know which clock they're setting. */
  timeZoneLabel?: string;
  arriveEarlyMin?: number;
  onArriveEarlyChange?: (min: number) => void;
  conflictWarning?: string | null;
}) {
  const check = validateWhenRange(value);
  const lengthMin = rangeLengthMin(value);
  const spansDays = value.endDate !== value.startDate;
  const isPreset = LENGTH_PRESETS.some((p) => p.min === lengthMin);

  const [showEndDate, setShowEndDate] = useState(spansDays);
  const [showEndTime, setShowEndTime] = useState(!isPreset && !value.allDay);
  const [showCalendar, setShowCalendar] = useState(false);
  const [precise, setPrecise] = useState(minutesOfTime(value.startTime) % 5 !== 0);

  const nextSaturday = nextWeekday(todayKey, 6);
  const dayChips = [
    { key: todayKey, label: "Today" },
    { key: addDaysToKey(todayKey, 1), label: "Tomorrow" },
    { key: nextSaturday, label: WEEKDAY_LABELS[weekdayOfKey(nextSaturday)] },
  ].filter((c, i, arr) => arr.findIndex((x) => x.key === c.key) === i);

  const setStartDate = (startDate: string) => {
    const shift = spansDays ? 1 : 0;
    onChange({ ...value, startDate, endDate: addDaysToKey(startDate, shift) });
  };

  const setStartTime = (startTime: string) =>
    onChange(setRangeDuration({ ...value, startTime }, lengthMin || 90));

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <DtLabel>Day</DtLabel>
        {timeZoneLabel && (
          <span className="text-[10px] font-semibold text-muted-foreground">{timeZoneLabel}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {dayChips.map((c) => (
          <DtChip
            key={c.key}
            active={value.startDate === c.key && !showCalendar}
            onClick={() => {
              setShowCalendar(false);
              setStartDate(c.key);
            }}
          >
            {c.label}
          </DtChip>
        ))}
        <DtChip
          active={showCalendar}
          ariaLabel="Open calendar"
          onClick={() => setShowCalendar((v) => !v)}
        >
          {dayChips.some((c) => c.key === value.startDate)
            ? "Pick date"
            : friendlyDayLabelKey(value.startDate, todayKey)}
        </DtChip>
      </div>

      {showCalendar && (
        <MultiDateCalendar
          mode="single"
          selected={[value.startDate]}
          minKey={todayKey}
          onSelect={(k) => {
            setStartDate(k);
            setShowCalendar(false);
          }}
        />
      )}

      {!value.allDay && (
        <div>
          <DtLabel>Starts at</DtLabel>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <TimeField
              label="Start time"
              value={value.startTime}
              step={precise ? 60 : 300}
              onChange={setStartTime}
            />
            {showEndTime ? (
              <>
                <span className="text-xs text-muted-foreground">to</span>
                <TimeField
                  label="End time"
                  value={value.endTime}
                  step={precise ? 60 : 300}
                  onChange={(endTime) => onChange({ ...value, endTime })}
                />
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowEndTime(true)}
                className="text-xs font-semibold text-muted-foreground underline decoration-dotted"
              >
                ends {formatTimeKey(value.endTime)}
              </button>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="micro-label text-muted-foreground">
              Length
            </span>
            {LENGTH_PRESETS.map((p) => (
              <DtChip
                key={p.min}
                active={lengthMin === p.min && !showEndTime}
                onClick={() => {
                  setShowEndTime(false);
                  setShowEndDate(false);
                  onChange(setRangeDuration(value, p.min));
                }}
              >
                {p.label}
              </DtChip>
            ))}
            <DtChip active={showEndTime} onClick={() => setShowEndTime(true)}>
              Custom
            </DtChip>
            <DtChip
              active={precise}
              ariaLabel="Toggle minute precision"
              onClick={() => setPrecise((v) => !v)}
            >
              To the minute
            </DtChip>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <DtChip
          active={value.allDay}
          ariaLabel="Toggle all-day event"
          onClick={() => onChange({ ...value, allDay: !value.allDay })}
        >
          All day
        </DtChip>
        {showEndDate || spansDays ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-muted-foreground">Ends on</span>
            <input
              type="date"
              aria-label="End date"
              min={value.startDate || todayKey}
              value={value.endDate}
              onChange={(e) => onChange({ ...value, endDate: e.target.value })}
              className={dtInputCls}
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

      {onArriveEarlyChange && !value.allDay && (
        <div>
          <DtLabel>Arrive early</DtLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ARRIVE_PRESETS.map((m) => (
              <DtChip
                key={m}
                active={(arriveEarlyMin ?? 0) === m}
                onClick={() => onArriveEarlyChange(m)}
              >
                {m === 0 ? "Not needed" : `${m} min`}
              </DtChip>
            ))}
          </div>
        </div>
      )}

      <DtSummary ok={check.ok}>{check.ok ? formatWhenRange(value) : check.error}</DtSummary>

      {check.ok && !value.allDay && (
        <DtSummary>
          {formatDuration(lengthMin)} long
          {(arriveEarlyMin ?? 0) > 0
            ? ` · be there by ${formatTimeKey(
                timeFromMinutes(minutesOfTime(value.startTime) - (arriveEarlyMin ?? 0)),
              )}`
            : ""}
        </DtSummary>
      )}

      {conflictWarning && (
        <p className="rounded-xl border border-coral/40 bg-coral/10 px-3 py-2 text-[11px] font-semibold text-coral">
          {conflictWarning}
        </p>
      )}
    </div>
  );
}

function nextWeekday(fromKey: string, weekday: number): string {
  for (let i = 1; i <= 7; i++) {
    const k = addDaysToKey(fromKey, i);
    if (weekdayOfKey(k) === weekday) return k;
  }
  return fromKey;
}

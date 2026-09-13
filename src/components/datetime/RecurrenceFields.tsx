import { WEEKDAY_INITIALS, friendlyDayLabelKey, weekdayOfKey } from "@/lib/datetime";
import {
  DEFAULT_COUNT,
  FREQ_OPTIONS,
  MAX_OCCURRENCES,
  describeRule,
  expandRecurrence,
  isRepeating,
  toggleException,
  type RecurrenceFreq,
  type RecurrenceRule,
} from "@/lib/recurrence";
import { DtChip, DtLabel, DtSummary, dtInputCls } from "./primitives";

/** Repeat controls: frequency, weekdays, an end rule, and skippable dates. */
export function RecurrenceFields({
  startKey,
  todayKey,
  value,
  onChange,
}: {
  startKey: string;
  todayKey: string;
  value: RecurrenceRule;
  onChange: (next: RecurrenceRule) => void;
}) {
  const dates = expandRecurrence(startKey, value);
  const withExceptions = expandRecurrence(startKey, { ...value, exceptions: [] });
  const skipped = new Set(value.exceptions ?? []);

  const setFreq = (freq: RecurrenceFreq) => {
    if (freq === "none") return onChange({ freq: "none" });
    onChange({
      freq,
      weekdays:
        freq === "weekly" || freq === "biweekly"
          ? value.weekdays?.length
            ? value.weekdays
            : [weekdayOfKey(startKey)]
          : [],
      count: value.count ?? DEFAULT_COUNT,
      until: value.until ?? null,
      exceptions: value.exceptions ?? [],
    });
  };

  const toggleWeekday = (d: number) => {
    const set = new Set(value.weekdays ?? []);
    if (set.has(d)) set.delete(d);
    else set.add(d);
    onChange({ ...value, weekdays: [...set] });
  };

  return (
    <div className="space-y-3">
      <div>
        <DtLabel>Repeat</DtLabel>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {FREQ_OPTIONS.map((f) => (
            <DtChip key={f.value} active={value.freq === f.value} onClick={() => setFreq(f.value)}>
              {f.label}
            </DtChip>
          ))}
        </div>
      </div>

      {(value.freq === "weekly" || value.freq === "biweekly") && (
        <div>
          <DtLabel>On these days</DtLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {WEEKDAY_INITIALS.map((label, d) => (
              <button
                key={d}
                type="button"
                aria-label={`Toggle ${label}`}
                aria-pressed={value.weekdays?.includes(d) ?? false}
                onClick={() => toggleWeekday(d)}
                className={`size-9 rounded-full border text-[12px] font-bold transition-colors ${
                  value.weekdays?.includes(d)
                    ? "border-lime bg-lime text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-lime/60"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isRepeating(value) && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <DtLabel>Ends</DtLabel>
            <DtChip
              active={value.until == null}
              onClick={() =>
                onChange({ ...value, until: null, count: value.count ?? DEFAULT_COUNT })
              }
            >
              After
            </DtChip>
            {value.until == null && (
              <input
                type="number"
                min={1}
                max={MAX_OCCURRENCES}
                aria-label="Number of occurrences"
                value={value.count ?? DEFAULT_COUNT}
                onChange={(e) => onChange({ ...value, count: Number(e.target.value) })}
                className={`w-20 ${dtInputCls}`}
              />
            )}
            <DtChip
              active={value.until != null}
              onClick={() => onChange({ ...value, count: null, until: value.until ?? startKey })}
            >
              On date
            </DtChip>
            {value.until != null && (
              <input
                type="date"
                aria-label="Repeat until"
                min={startKey}
                value={value.until}
                onChange={(e) => onChange({ ...value, until: e.target.value })}
                className={dtInputCls}
              />
            )}
          </div>

          <div>
            <DtLabel>Dates ({dates.length})</DtLabel>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {withExceptions.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={!skipped.has(k)}
                  onClick={() => onChange(toggleException(value, k))}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    skipped.has(k)
                      ? "border-border bg-background text-muted-foreground line-through"
                      : "border-lime/60 bg-lime/10 text-foreground"
                  }`}
                >
                  {friendlyDayLabelKey(k, todayKey)}
                </button>
              ))}
            </div>
            <DtSummary>Tap a date to skip it. {describeRule(value, startKey)}</DtSummary>
          </div>
        </>
      )}
    </div>
  );
}

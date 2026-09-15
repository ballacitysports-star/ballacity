import { Clock, Copy } from "lucide-react";
import { WEEKDAYS, dayHours, formatDayHours, type DayHours, type OrgHours } from "@/lib/org-hours";

/**
 * Per-weekday opening hours editor with "closed" / "open 24 hours" toggles
 * and a copy-to-all-days shortcut.
 */
export function HoursEditor({
  value,
  onChange,
}: {
  value: OrgHours;
  onChange: (v: OrgHours) => void;
}) {
  function setDay(day: number, patch: DayHours | null) {
    const next: OrgHours = { ...value };
    if (patch === null) delete next[String(day)];
    else next[String(day)] = patch;
    onChange(next);
  }

  function copyToAll(day: number) {
    const src = dayHours(value, day);
    const next: OrgHours = {};
    for (let d = 0; d < 7; d++) next[String(d)] = { ...src };
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {WEEKDAYS.map((label, day) => {
        const d = dayHours(value, day);
        const range = d.ranges?.[0] ?? { open: "09:00", close: "21:00" };
        const disabled = !!d.closed || !!d.open24;
        return (
          <div key={label} className="rounded-xl border border-border bg-background p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{label}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setDay(day, d.closed ? { ranges: [range] } : { closed: true })}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    d.closed
                      ? "bg-coral/15 text-coral"
                      : "border border-border text-muted-foreground"
                  }`}
                >
                  Closed
                </button>
                <button
                  type="button"
                  onClick={() => setDay(day, d.open24 ? { ranges: [range] } : { open24: true })}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    d.open24 ? "bg-lime/15 text-lime" : "border border-border text-muted-foreground"
                  }`}
                >
                  24 h
                </button>
                <button
                  type="button"
                  onClick={() => copyToAll(day)}
                  title="Copy to all days"
                  aria-label={`Copy ${label} hours to all days`}
                  className="rounded-full border border-border p-1.5 text-muted-foreground"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
            {disabled ? (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> {formatDayHours(d)}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={range.open}
                  onChange={(e) => setDay(day, { ranges: [{ ...range, open: e.target.value }] })}
                  aria-label={`${label} opening time`}
                  className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  type="time"
                  value={range.close}
                  onChange={(e) => setDay(day, { ranges: [{ ...range, close: e.target.value }] })}
                  aria-label={`${label} closing time`}
                  className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

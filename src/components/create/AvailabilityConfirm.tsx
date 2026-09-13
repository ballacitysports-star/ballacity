import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Globe2, RotateCcw } from "lucide-react";
import {
  DEFAULT_TZ,
  TZ_OPTIONS,
  fmt12,
  getBrowserTz,
  instantToWall,
  tzRelativeLabel,
  tzShortName,
  wallTimeToInstant,
  type Tz,
} from "@/lib/tz";

type Slot = {
  day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  start: string;
  end: string;
  venue?: string;
};
type Override = {
  date: string;
  closed?: boolean;
  windows?: { start: string; end: string; venue?: string }[];
};

const DAY_ORDER: Slot["day"][] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function addDays(d: Date, n: number) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Confirmation step: turns the weekly template into a selectable calendar
 * preview for the next 4 weeks, correctly resolved in the trainer's tz.
 * Deselecting a day writes a `closed: true` override for that date.
 */
export function AvailabilityConfirm({
  slots,
  overrides,
  timezone,
  onChangeOverrides,
  onChangeTimezone,
  onReset,
  weeks = 4,
}: {
  slots: Slot[];
  overrides: Override[];
  timezone: Tz;
  onChangeOverrides: (o: Override[]) => void;
  onChangeTimezone: (tz: Tz) => void;
  onReset?: () => void;
  weeks?: number;
}) {
  const viewerTz = getBrowserTz();
  const tz = timezone || DEFAULT_TZ;
  const [weekOffset, setWeekOffset] = useState(0);

  // Anchor at today (in trainer tz), then step by weeks of 7 days.
  const anchor = useMemo(() => {
    const nowWall = instantToWall(new Date(), tz);
    const [y, m, d] = nowWall.dateKey.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }, [tz]);

  const days = useMemo(() => {
    const start = addDays(anchor, weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [anchor, weekOffset]);

  const overrideMap = useMemo(() => {
    const m = new Map<string, Override>();
    for (const o of overrides) m.set(o.date, o);
    return m;
  }, [overrides]);

  // Group slots by weekday key.
  const slotsByDay = useMemo(() => {
    const m: Record<string, Slot[]> = {};
    for (const s of slots) (m[s.day] ??= []).push(s);
    return m;
  }, [slots]);

  const jsToKey: Slot["day"][] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  function toggleDay(d: Date, wasActive: boolean, hasBaseSlots: boolean) {
    const key = dateKey(d);
    const next = overrides.filter((o) => o.date !== key);
    if (wasActive) {
      // Turn off: only need override if base template has slots that day.
      if (hasBaseSlots) next.push({ date: key, closed: true });
    }
    onChangeOverrides(next);
  }

  const totalActive = days.reduce((n, d) => {
    const key = dateKey(d);
    const dayKey = jsToKey[d.getUTCDay()];
    const base = slotsByDay[dayKey] ?? [];
    if (base.length === 0) return n;
    const ov = overrideMap.get(key);
    if (ov?.closed) return n;
    return n + base.length;
  }, 0);

  const closedCount = days.reduce((n, d) => {
    const key = dateKey(d);
    const dayKey = jsToKey[d.getUTCDay()];
    const base = slotsByDay[dayKey] ?? [];
    if (base.length === 0) return n;
    return overrideMap.get(key)?.closed ? n + 1 : n;
  }, 0);

  const hasOverrides = overrides.length > 0;

  const range = `${days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const relLabel = tzRelativeLabel(tz, viewerTz);
  const shortNow = tzShortName(new Date(), tz);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-lime/30 bg-lime/5 px-3 py-2.5">
        <div className="flex items-center gap-2 text-[11px] text-lime">
          <Globe2 className="h-3.5 w-3.5" />
          <span className="font-bold">Times shown in your trainer timezone</span>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {tz} · {shortNow}
          {relLabel && <span className="ml-1 text-foreground/70">({relLabel})</span>}
        </div>
        <select
          value={tz}
          onChange={(e) => onChangeTimezone(e.target.value)}
          className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs outline-none focus:border-lime"
        >
          <option value={viewerTz}>Use my current: {viewerTz}</option>
          {TZ_OPTIONS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.zones.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label} ({z.value})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={weekOffset === 0}
          onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-surface disabled:opacity-40"
          aria-label="Previous week"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            Week {weekOffset + 1} of {weeks}
          </div>
          <div className="text-sm font-bold">{range}</div>
        </div>
        <button
          type="button"
          disabled={weekOffset >= weeks - 1}
          onClick={() => setWeekOffset((w) => Math.min(weeks - 1, w + 1))}
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-surface disabled:opacity-40"
          aria-label="Next week"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {hasOverrides && (
        <button
          type="button"
          onClick={() => onReset?.()}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 py-2.5 text-xs font-bold text-muted-foreground transition-colors hover:border-lime hover:text-lime"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to weekly template
          {closedCount > 0 && (
            <span className="rounded-full bg-coral/10 px-2 py-0.5 text-[10px] text-coral">
              {closedCount} off
            </span>
          )}
        </button>
      )}

      <div className="grid gap-2">
        {days.map((d) => {
          const key = dateKey(d);
          const dayKey = jsToKey[d.getUTCDay()];
          const base = slotsByDay[dayKey] ?? [];
          const ov = overrideMap.get(key);
          const closed = !!ov?.closed;
          const active = base.length > 0 && !closed;
          const hasBase = base.length > 0;
          const label = d.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          });
          // Compute example instant to show viewer-tz preview.
          const preview = base[0]
            ? (() => {
                const instant = wallTimeToInstant(key, base[0].start, tz);
                const viewerWall = instantToWall(instant, viewerTz);
                return viewerTz !== tz ? `${fmt12(viewerWall.hhmm)} your time` : null;
              })()
            : null;
          return (
            <button
              key={key}
              type="button"
              disabled={!hasBase}
              onClick={() => toggleDay(d, active, hasBase)}
              className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
                !hasBase
                  ? "border-border/40 bg-surface/40 opacity-50"
                  : active
                    ? "border-lime bg-lime/10"
                    : "border-coral/40 bg-coral/5"
              }`}
              aria-pressed={active}
            >
              <div className="min-w-0">
                <div
                  className={`text-sm font-bold ${active ? "text-lime" : hasBase ? "text-coral" : ""}`}
                >
                  {label}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {hasBase
                    ? base.map((s) => `${fmt12(s.start)} – ${fmt12(s.end)}`).join(" · ")
                    : "No template slot"}
                </div>
                {preview && active && (
                  <div className="text-[10px] text-muted-foreground/80">{preview}</div>
                )}
              </div>
              {hasBase && (
                <span
                  className={`ml-3 shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
                    active ? "bg-lime/20 text-lime" : "bg-coral/20 text-coral"
                  }`}
                >
                  {active ? <Check className="h-3 w-3" /> : "OFF"}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border bg-surface/60 px-3 py-2.5 text-[11px] text-muted-foreground">
        <span className="text-foreground font-bold">{totalActive}</span> confirmed session
        {totalActive === 1 ? "" : "s"} this week. Tap any day to opt out — athletes won't be able to
        book you then.
      </div>
    </div>
  );
}

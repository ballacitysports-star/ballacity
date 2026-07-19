import type { Slot } from "./availability-slots";

export type Weekday = Slot["day"];

export type OverrideWindow = {
  start: string; // HH:MM
  end: string;   // HH:MM
  venue?: string;
};

export type DayOverride = {
  date: string; // YYYY-MM-DD (local)
  closed?: boolean;
  windows?: OverrideWindow[];
};

export type ResolvedWindow = {
  start: string;
  end: string;
  venue?: string;
  source: "weekly" | "override";
};

export const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Returns YYYY-MM-DD in local time. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string as a local date at midnight. */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function weekdayOf(d: Date): Weekday {
  return WEEKDAYS[d.getDay()];
}

/** Max horizon: 6 months from today (inclusive). */
export function maxHorizonDate(from: Date = new Date()): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setMonth(d.getMonth() + 6);
  return d;
}

/** Resolve the availability windows for a single day. Overrides fully replace the weekly base for that date. */
export function resolveDay(
  date: Date,
  weekly: Slot[] = [],
  overrides: DayOverride[] = [],
  venueFilter?: string | null,
): ResolvedWindow[] {
  const key = toDateKey(date);
  const override = overrides.find((o) => o.date === key);
  const windows: ResolvedWindow[] = override
    ? override.closed
      ? []
      : (override.windows ?? []).map((w) => ({ ...w, source: "override" as const }))
    : weekly
        .filter((s) => s.day === weekdayOf(date))
        .map((s) => ({ start: s.start, end: s.end, venue: s.venue, source: "weekly" as const }));
  if (!venueFilter) return windows;
  const target = venueFilter.trim().toLowerCase();
  return windows.filter((w) => (w.venue ?? "").trim().toLowerCase() === target);
}

/** True if the given date has any resolved availability window. */
export function hasAvailability(
  date: Date,
  weekly: Slot[] = [],
  overrides: DayOverride[] = [],
  venueFilter?: string | null,
): boolean {
  return resolveDay(date, weekly, overrides, venueFilter).length > 0;
}


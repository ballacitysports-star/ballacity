import type { Slot } from "./availability-slots";
import { wallTimeToInstant, instantToWall } from "./tz";

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
  /** True when the window (in the viewer's tz) wraps past midnight from a trainer-tz day. */
  crossesDay?: boolean;
  /** Trainer-tz wall time of the same window, for dual-labelling. */
  trainerStart?: string;
  trainerEnd?: string;
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

type ResolveOpts = {
  venueFilter?: string | null;
  /** When set, `date` is interpreted in `viewerTz` and windows are converted from `trainerTz`. */
  trainerTz?: string | null;
  viewerTz?: string | null;
};

/**
 * Resolve the availability windows for a single day.
 *
 * Two modes:
 * 1. Legacy (no tz): treat `date` as trainer-local wall-clock; look up windows
 *    for that weekday / date-key and return them as-is.
 * 2. Tz-aware (both `trainerTz` and `viewerTz` provided, and they differ):
 *    treat `date` as viewer-local; enumerate the trainer-local dates that
 *    touch this viewer day; convert each window from trainer wall → UTC
 *    instant → viewer wall; clip to the viewer day; return in viewer tz.
 */
export function resolveDay(
  date: Date,
  weekly: Slot[] = [],
  overrides: DayOverride[] = [],
  optsOrVenueFilter?: ResolveOpts | string | null,
): ResolvedWindow[] {
  const opts: ResolveOpts =
    typeof optsOrVenueFilter === "string" || optsOrVenueFilter === null || optsOrVenueFilter === undefined
      ? { venueFilter: optsOrVenueFilter ?? null }
      : optsOrVenueFilter;
  const { venueFilter, trainerTz, viewerTz } = opts;

  const useTz = !!(trainerTz && viewerTz && trainerTz !== viewerTz);

  if (!useTz) {
    const key = toDateKey(date);
    const override = overrides.find((o) => o.date === key);
    const windows: ResolvedWindow[] = override
      ? override.closed
        ? []
        : (override.windows ?? []).map((w) => ({ ...w, source: "override" as const }))
      : weekly
          .filter((s) => s.day === weekdayOf(date))
          .map((s) => ({ start: s.start, end: s.end, venue: s.venue, source: "weekly" as const }));
    return applyVenueFilter(windows, venueFilter);
  }

  // Tz-aware path — lazy import to keep the resolver dependency-light.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { wallTimeToInstant, instantToWall } = require("./tz") as typeof import("./tz");
  const dayStartViewer = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEndViewer = new Date(dayStartViewer.getTime() + 24 * 3600_000);

  // Determine which trainer-local dates could contribute windows overlapping this viewer day.
  const trainerAtStart = instantToWall(dayStartViewer, trainerTz!);
  const trainerAtEnd = instantToWall(new Date(dayEndViewer.getTime() - 1), trainerTz!);
  const candidateDates = new Set<string>([trainerAtStart.dateKey, trainerAtEnd.dateKey]);

  const out: ResolvedWindow[] = [];
  for (const tKey of candidateDates) {
    const tDate = fromDateKey(tKey);
    const override = overrides.find((o) => o.date === tKey);
    const raw = override
      ? override.closed
        ? []
        : (override.windows ?? []).map((w) => ({ ...w, source: "override" as const }))
      : weekly
          .filter((s) => s.day === weekdayOf(tDate))
          .map((s) => ({ start: s.start, end: s.end, venue: s.venue, source: "weekly" as const }));

    for (const w of raw) {
      const startInst = wallTimeToInstant(tKey, w.start, trainerTz!);
      const endInst = wallTimeToInstant(tKey, w.end, trainerTz!);
      // Clip to viewer day
      const s = new Date(Math.max(startInst.getTime(), dayStartViewer.getTime()));
      const e = new Date(Math.min(endInst.getTime(), dayEndViewer.getTime()));
      if (e.getTime() <= s.getTime()) continue;
      const sw = instantToWall(s, viewerTz!);
      const ew = instantToWall(e, viewerTz!);
      // If end lands at exactly next midnight, show 24:00 as the last minute of the day.
      const endHHMM =
        ew.dateKey !== sw.dateKey && ew.hhmm === "00:00" ? "24:00" : ew.hhmm;
      out.push({
        start: sw.hhmm,
        end: endHHMM,
        venue: w.venue,
        source: w.source,
        crossesDay: startInst < dayStartViewer || endInst > dayEndViewer,
        trainerStart: w.start,
        trainerEnd: w.end,
      });
    }
  }

  // Sort by start time and dedupe identical windows (a weekly + override edge could double-list).
  out.sort((a, b) => a.start.localeCompare(b.start));
  const dedup: ResolvedWindow[] = [];
  for (const w of out) {
    if (!dedup.some((x) => x.start === w.start && x.end === w.end && x.venue === w.venue)) {
      dedup.push(w);
    }
  }
  return applyVenueFilter(dedup, venueFilter);
}

function applyVenueFilter(windows: ResolvedWindow[], venueFilter?: string | null): ResolvedWindow[] {
  if (!venueFilter) return windows;
  const target = venueFilter.trim().toLowerCase();
  return windows.filter((w) => (w.venue ?? "").trim().toLowerCase() === target);
}

/** True if the given date has any resolved availability window. */
export function hasAvailability(
  date: Date,
  weekly: Slot[] = [],
  overrides: DayOverride[] = [],
  optsOrVenueFilter?: ResolveOpts | string | null,
): boolean {
  return resolveDay(date, weekly, overrides, optsOrVenueFilter).length > 0;
}



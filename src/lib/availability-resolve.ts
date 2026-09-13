import type { Slot } from "./availability-slots";
import { wallTimeToInstant, instantToWall } from "./tz";

export type Weekday = Slot["day"];

export type OverrideWindow = {
  start: string; // HH:MM
  end: string; // HH:MM
  venue?: string;
};

export type DayOverride = {
  date: string; // YYYY-MM-DD (local)
  closed?: boolean;
  windows?: OverrideWindow[];
};

/**
 * A recurring availability rule that expands into windows on matching dates.
 * `freq`:
 *  - "weekly"       — every N weeks (interval; default 1) on the listed weekdays.
 *  - "biweekly"     — shorthand for weekly with interval = 2.
 *  - "monthly-nth"  — the listed weekdays, but only on the given weeks-of-month (1..4 or "last").
 */
export type AvailabilityRule = {
  id: string;
  label?: string;
  weekdays: Weekday[];
  start: string; // HH:MM
  end: string; // HH:MM
  venue?: string;
  freq: "weekly" | "biweekly" | "monthly-nth";
  interval?: number;
  weekOfMonth?: (1 | 2 | 3 | 4 | "last")[];
  /** Start of recurrence (YYYY-MM-DD). Also sets the bi-weekly phase. */
  anchorDate: string;
  /** Optional end (YYYY-MM-DD). Rule doesn't fire after this date. */
  until?: string;
};

export type ResolvedWindow = {
  start: string;
  end: string;
  venue?: string;
  source: "weekly" | "override" | "rule";
  /** Rule id when source === "rule", for labelling. */
  ruleId?: string;
  ruleLabel?: string;
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

/** Returns 1..5 — which occurrence of this weekday within the month `d` sits at. */
function weekOfMonth(d: Date): number {
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

/** True when `d` is the *last* occurrence of its weekday in the month. */
function isLastWeekOfMonth(d: Date): boolean {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
  return next.getMonth() !== d.getMonth();
}

function withinRuleRange(dateKey: string, rule: AvailabilityRule): boolean {
  if (dateKey < rule.anchorDate) return false;
  if (rule.until && dateKey > rule.until) return false;
  return true;
}

/** Returns the windows this rule contributes to the given trainer-local date (may be empty). */
export function expandRule(
  rule: AvailabilityRule,
  date: Date,
): { start: string; end: string; venue?: string }[] {
  const key = toDateKey(date);
  if (!withinRuleRange(key, rule)) return [];
  const dow = weekdayOf(date);
  if (!rule.weekdays.includes(dow)) return [];

  if (rule.freq === "weekly" || rule.freq === "biweekly") {
    const interval = rule.freq === "biweekly" ? 2 : Math.max(1, rule.interval ?? 1);
    if (interval > 1) {
      const anchor = fromDateKey(rule.anchorDate);
      const anchorWeekStart = new Date(anchor);
      anchorWeekStart.setDate(anchor.getDate() - anchor.getDay());
      const thisWeekStart = new Date(date);
      thisWeekStart.setDate(date.getDate() - date.getDay());
      const weeks = Math.round(
        (thisWeekStart.getTime() - anchorWeekStart.getTime()) / (7 * 86_400_000),
      );
      if (weeks < 0 || weeks % interval !== 0) return [];
    }
  } else if (rule.freq === "monthly-nth") {
    const weeks = rule.weekOfMonth ?? [];
    if (weeks.length === 0) return [];
    const wom = weekOfMonth(date);
    const isLast = isLastWeekOfMonth(date);
    const matches = weeks.some((w) => (w === "last" ? isLast : w === wom));
    if (!matches) return [];
  }

  return [{ start: rule.start, end: rule.end, venue: rule.venue }];
}

type ResolveOpts = {
  venueFilter?: string | null;
  /** When set, `date` is interpreted in `viewerTz` and windows are converted from `trainerTz`. */
  trainerTz?: string | null;
  viewerTz?: string | null;
  /** Recurring rules layer. */
  rules?: AvailabilityRule[];
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
    typeof optsOrVenueFilter === "string" ||
    optsOrVenueFilter === null ||
    optsOrVenueFilter === undefined
      ? { venueFilter: optsOrVenueFilter ?? null }
      : optsOrVenueFilter;
  const { venueFilter, trainerTz, viewerTz, rules = [] } = opts;

  const useTz = !!(trainerTz && viewerTz && trainerTz !== viewerTz);

  const rawFor = (
    tDate: Date,
  ): (OverrideWindow & {
    source: ResolvedWindow["source"];
    ruleId?: string;
    ruleLabel?: string;
  })[] => {
    const tKey = toDateKey(tDate);
    const override = overrides.find((o) => o.date === tKey);
    if (override) {
      if (override.closed) return [];
      return (override.windows ?? []).map((w) => ({ ...w, source: "override" as const }));
    }
    const dow = weekdayOf(tDate);
    const weeklyWins = weekly
      .filter((s) => s.day === dow)
      .map((s) => ({ start: s.start, end: s.end, venue: s.venue, source: "weekly" as const }));
    const ruleWins = rules.flatMap((r) =>
      expandRule(r, tDate).map((w) => ({
        ...w,
        source: "rule" as const,
        ruleId: r.id,
        ruleLabel: r.label,
      })),
    );
    // Merge, dedupe by start+end+venue (prefer rule over weekly).
    const merged: typeof weeklyWins = [];
    const seen = new Set<string>();
    for (const w of [...ruleWins, ...weeklyWins]) {
      const k = `${w.start}|${w.end}|${(w.venue ?? "").trim().toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(w as (typeof merged)[number]);
    }
    return merged;
  };

  if (!useTz) {
    const windows: ResolvedWindow[] = rawFor(date).map((w) => ({
      start: w.start,
      end: w.end,
      venue: w.venue,
      source: w.source,
      ruleId: w.ruleId,
      ruleLabel: w.ruleLabel,
    }));
    return applyVenueFilter(windows, venueFilter);
  }

  // Tz-aware path — enumerate trainer-local dates that touch this viewer day.
  const dayStartViewer = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEndViewer = new Date(dayStartViewer.getTime() + 24 * 3600_000);
  const trainerAtStart = instantToWall(dayStartViewer, trainerTz!);
  const trainerAtEnd = instantToWall(new Date(dayEndViewer.getTime() - 1), trainerTz!);
  const candidateDates = new Set<string>([trainerAtStart.dateKey, trainerAtEnd.dateKey]);

  const out: ResolvedWindow[] = [];
  for (const tKey of candidateDates) {
    const tDate = fromDateKey(tKey);
    const raw = rawFor(tDate);
    for (const w of raw) {
      const startInst = wallTimeToInstant(tKey, w.start, trainerTz!);
      const endInst = wallTimeToInstant(tKey, w.end, trainerTz!);
      const s = new Date(Math.max(startInst.getTime(), dayStartViewer.getTime()));
      const e = new Date(Math.min(endInst.getTime(), dayEndViewer.getTime()));
      if (e.getTime() <= s.getTime()) continue;
      const sw = instantToWall(s, viewerTz!);
      const ew = instantToWall(e, viewerTz!);
      const endHHMM = ew.dateKey !== sw.dateKey && ew.hhmm === "00:00" ? "24:00" : ew.hhmm;
      out.push({
        start: sw.hhmm,
        end: endHHMM,
        venue: w.venue,
        source: w.source,
        ruleId: w.ruleId,
        ruleLabel: w.ruleLabel,
        crossesDay: startInst < dayStartViewer || endInst > dayEndViewer,
        trainerStart: w.start,
        trainerEnd: w.end,
      });
    }
  }

  out.sort((a, b) => a.start.localeCompare(b.start));
  const dedup: ResolvedWindow[] = [];
  for (const w of out) {
    if (!dedup.some((x) => x.start === w.start && x.end === w.end && x.venue === w.venue)) {
      dedup.push(w);
    }
  }
  return applyVenueFilter(dedup, venueFilter);
}

function applyVenueFilter(
  windows: ResolvedWindow[],
  venueFilter?: string | null,
): ResolvedWindow[] {
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

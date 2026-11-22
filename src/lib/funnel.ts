/**
 * WP 5.2: the pilot funnel as the SuperAdmin Funnel card shows it.
 *
 * The numbers come from public.superadmin_funnel (supabase/migrations/20261127100000_superadmin_funnel.sql), which counts
 * on the server, per America/New_York week, totals only, and sends every count from 1 to 4 as the string "<5". This
 * module reads that answer, checks its shape, and masks again on the way in (maskSmallCount's threshold), so a raw small
 * count could not reach the screen even if the server sent one. 0 stays 0: it names nobody.
 *
 * The under-18 / unknown-age column (`not_confirmed_adult`) exists only while the server-side switch is on
 * (app_settings 'funnel_minor_counts', turned on only by superadmin_set_funnel_minor_counts after counsel's sign-off,
 * pilot checklist B1). The card shows it only when the report says `minors_column: true` and the week carries it.
 */
import { maskSmallCount, type MaskedCount } from "@/lib/sport-activity";

export const FUNNEL_MINOR_COUNTS_KEY = "funnel_minor_counts";
export const FUNNEL_PILOT_START_KEY = "funnel_pilot_start";
/** Weeks the card offers; the server caps a request at 26. */
export const FUNNEL_WINDOWS = [4, 8, 16] as const;
export type FunnelWindow = (typeof FUNNEL_WINDOWS)[number];

/** One funnel row: a count the server returns per week, in the plan's order (steps 1-10, then the extra lines). */
export type FunnelRow = { key: FunnelCountKey; label: string; step?: string; detail?: string };

export const FUNNEL_COUNT_KEYS = [
  "posters",
  "posters_invited",
  "posters_self_joined",
  "invites_sent",
  "invites_seen",
  "invites_answered",
  "invites_accepted",
  "invites_joined",
  "invites_game_started",
  "invites_attendance_marked",
  "invites_showed_up",
  "invites_late_leaves",
  "invites_game_cancelled",
  "invites_to_series_games",
  "games_held",
  "games_held_series",
  "games_cancelled",
  "series_games_left_out",
] as const;
export type FunnelCountKey = (typeof FUNNEL_COUNT_KEYS)[number];

export const FUNNEL_ROWS: readonly FunnelRow[] = [
  {
    key: "posters",
    step: "1",
    label: "Posted availability",
    detail: "People with a post that week",
  },
  {
    key: "posters_invited",
    step: "2",
    label: "Posters invited",
    detail: "Invited within 7 days of posting",
  },
  {
    key: "posters_self_joined",
    label: "Posters who joined on their own",
    detail: "Approximate: nothing links a self-join to a post",
  },
  { key: "invites_sent", step: "3", label: "Invites sent" },
  {
    key: "invites_seen",
    step: "4",
    label: "Invites seen",
    detail: "Notification read, or answered",
  },
  { key: "invites_answered", step: "5", label: "Answered" },
  { key: "invites_accepted", step: "5", label: "Accepted" },
  {
    key: "invites_joined",
    step: "6",
    label: "Joined",
    detail: "On the roster, or the request approved",
  },
  { key: "invites_game_started", step: "7", label: "Game started, not cancelled" },
  { key: "invites_attendance_marked", step: "8", label: "Attendance marked" },
  { key: "invites_showed_up", step: "9", label: "Showed up" },
  { key: "invites_late_leaves", step: "10", label: "Late leaves" },
  { key: "invites_game_cancelled", label: "Joined, then the game was cancelled" },
  { key: "invites_to_series_games", label: "Invites to series games" },
  { key: "games_held", label: "Games held", detail: "Empty series copies left out" },
  { key: "games_held_series", label: "of which series games" },
  { key: "games_cancelled", label: "Games cancelled" },
  { key: "series_games_left_out", label: "Empty series games left out" },
];

export type FunnelGroup = Record<FunnelCountKey, MaskedCount> & {
  /** attendance marked / game started, in whole percent; null when either count is masked or there is nothing to divide. */
  markedCoveragePct: number | null;
  /** showed up / attendance marked; null as above. */
  showUpRatePct: number | null;
};

export type FunnelWeek = {
  weekStart: string;
  firstDay: string;
  lastDay: string;
  /** "history": every day from the saved daily totals (WP 5.3); "live": counted now; "mixed": both. */
  source: "history" | "live" | "mixed";
  adults: FunnelGroup;
  /** Accounts that are not confirmed adults (under 18, unknown age, age review pending). Only while the switch is on. */
  notConfirmedAdult?: FunnelGroup;
};

export type FunnelReport = {
  from: string;
  to: string;
  pilotStart: string | null;
  minorsColumn: boolean;
  history: { available: boolean; frozenBefore: string | null };
  weeks: FunnelWeek[];
};

export type FunnelResult = { available: false } | { available: true; report: FunnelReport };

/** A funnel count as it may be shown: 0 stays 0; 1 to 4 become "<5" (maskSmallCount); larger counts are exact. */
export function maskFunnelCount(n: number): MaskedCount {
  return n === 0 ? { value: 0, small: false } : maskSmallCount(n);
}

/** The server's value ("<5" or a whole number) as a MaskedCount, masked again; anything else reads as unknown. */
export function readFunnelCount(v: unknown): MaskedCount | null {
  if (v === "<5") return { value: null, small: true };
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return maskFunnelCount(v);
  return null;
}

export function formatFunnelCount(c: MaskedCount | null | undefined): string {
  if (!c) return "–";
  return c.small ? "<5" : String(c.value);
}

export function formatFunnelPct(p: number | null | undefined): string {
  return typeof p === "number" && Number.isFinite(p) ? `${p}%` : "–";
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-16" -> "Nov 16". The date is a New York calendar day, so it is read as written, never through a time zone. */
export function formatFunnelDay(day: string): string {
  if (!DATE.test(day)) return day;
  const [, m, d] = day.split("-").map(Number);
  return `${MONTHS[m - 1] ?? "?"} ${d}`;
}

/** The days a week column covers: "Nov 16 – 22", or "Nov 30 – Dec 6" across a month. */
export function formatFunnelWeek(w: Pick<FunnelWeek, "firstDay" | "lastDay">): string {
  const a = formatFunnelDay(w.firstDay);
  const b = formatFunnelDay(w.lastDay);
  if (a === b) return a;
  const [am] = a.split(" ");
  const [bm, bd] = b.split(" ");
  return am === bm ? `${a} – ${bd}` : `${a} – ${bm} ${bd}`;
}

function readGroup(raw: unknown): FunnelGroup | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const counts = {} as Record<FunnelCountKey, MaskedCount>;
  for (const key of FUNNEL_COUNT_KEYS) {
    const c = readFunnelCount(o[key]);
    if (!c) return null;
    counts[key] = c;
  }
  const pct = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    ...counts,
    markedCoveragePct: pct(o.marked_coverage_pct),
    showUpRatePct: pct(o.show_up_rate_pct),
  };
}

/** The superadmin_funnel answer, checked. Null when it is not the shape this card knows. */
export function parseFunnelReport(raw: unknown): FunnelReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.from !== "string" || typeof o.to !== "string" || !Array.isArray(o.weeks))
    return null;
  const minorsColumn = o.minors_column === true;
  const weeks: FunnelWeek[] = [];
  for (const w of o.weeks as unknown[]) {
    if (!w || typeof w !== "object") return null;
    const wk = w as Record<string, unknown>;
    const adults = readGroup(wk.adults);
    if (
      !adults ||
      typeof wk.week_start !== "string" ||
      typeof wk.first_day !== "string" ||
      typeof wk.last_day !== "string"
    )
      return null;
    const source = wk.source === "history" || wk.source === "mixed" ? wk.source : "live";
    const week: FunnelWeek = {
      weekStart: wk.week_start,
      firstDay: wk.first_day,
      lastDay: wk.last_day,
      source,
      adults,
    };
    // The under-18 column only when the switch says so, whatever else the week carries.
    if (minorsColumn) {
      const minors = readGroup(wk.not_confirmed_adult);
      if (minors) week.notConfirmedAdult = minors;
    }
    weeks.push(week);
  }
  const history =
    o.history && typeof o.history === "object" ? (o.history as Record<string, unknown>) : {};
  return {
    from: o.from,
    to: o.to,
    pilotStart: typeof o.pilot_start === "string" ? o.pilot_start : null,
    minorsColumn,
    history: {
      available: history.available === true,
      frozenBefore: typeof history.frozen_before === "string" ? history.frozen_before : null,
    },
    weeks,
  };
}

/** The funnel's weeks are America/New_York weeks (the pilot city). */
export const FUNNEL_TIME_ZONE = "America/New_York";

/** Today's date in New York, as the database counts it ("YYYY-MM-DD"). The UTC date runs a day ahead every evening. */
export function funnelToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUNNEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * The first day of a window of `weeks` weeks ending today in New York (the server snaps it to that week's Monday). Counting
 * from the UTC date would start a week late every evening that is already the next Monday in UTC.
 */
export function funnelWindowFrom(weeks: number, now: Date = new Date()): string {
  const [y, m, d] = funnelToday(now).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  day.setUTCDate(day.getUTCDate() - (Math.max(1, Math.floor(weeks)) - 1) * 7);
  return day.toISOString().slice(0, 10);
}

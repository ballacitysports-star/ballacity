/**
 * Pure helpers for the admin youth-oversight panel (minor time on platform +
 * parental-consent backlog).
 *
 * LEGAL REVIEW REQUIRED — the thresholds below decide when a backlog or an
 * overnight usage pattern is surfaced as a warning. They are operational
 * prompts for a human reviewer, not a statement of legal compliance.
 */

export const DAY_PART_META = {
  overnight_00_06: { label: "Overnight (12am–6am)", order: 0 },
  morning_06_12: { label: "Morning (6am–12pm)", order: 1 },
  afternoon_12_18: { label: "Afternoon (12pm–6pm)", order: 2 },
  evening_18_24: { label: "Evening (6pm–12am)", order: 3 },
} as const;

export type DayPart = keyof typeof DAY_PART_META;

export type TimeOnPlatformRow = {
  cohort: string;
  dayPart: string;
  members: number;
  avgDailyMinutes: number;
};

export type CohortUsage = {
  cohort: string;
  members: number;
  avgDailyMinutes: number;
  overnightMinutes: number;
};

export type ConsentBacklog = {
  required: number;
  pending: number;
  revoked: number;
  approved: number;
  stalePending: number;
  oldestPendingAt: string | null;
};

export function dayPartLabel(part: string) {
  return (DAY_PART_META as Record<string, { label: string }>)[part]?.label ?? part;
}

export function dayPartOrder(part: string) {
  return (DAY_PART_META as Record<string, { order: number }>)[part]?.order ?? 99;
}

/** Collapses per-day-part rows into one row per cohort. */
export function summarizeCohortUsage(rows: TimeOnPlatformRow[]): CohortUsage[] {
  const byCohort = new Map<string, CohortUsage>();
  for (const row of rows) {
    const entry = byCohort.get(row.cohort) ?? {
      cohort: row.cohort,
      members: 0,
      avgDailyMinutes: 0,
      overnightMinutes: 0,
    };
    entry.members = Math.max(entry.members, row.members);
    entry.avgDailyMinutes = Math.round((entry.avgDailyMinutes + row.avgDailyMinutes) * 10) / 10;
    if (row.dayPart === "overnight_00_06") {
      entry.overnightMinutes = Math.round((entry.overnightMinutes + row.avgDailyMinutes) * 10) / 10;
    }
    byCohort.set(row.cohort, entry);
  }
  return [...byCohort.values()].sort((a, b) => a.cohort.localeCompare(b.cohort));
}

/** Pending consents older than this many days need a human nudge. */
export const STALE_PENDING_DAYS = 7;

export function isStalePending(requestedAt: string | null, now = new Date()) {
  if (!requestedAt) return false;
  const t = new Date(requestedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > STALE_PENDING_DAYS * 86_400_000;
}

export type OversightTone = "ok" | "warn" | "danger";

/** Backlog health: any stale or revoked case is a warning; large queues escalate. */
export function backlogTone(backlog: ConsentBacklog): OversightTone {
  if (backlog.stalePending > 0 || backlog.revoked > 0) return "danger";
  if (backlog.required > 0 || backlog.pending > 0) return "warn";
  return "ok";
}

/** Overnight minutes are the signal the curfew settings exist to address. */
export function overnightTone(usage: CohortUsage[]): OversightTone {
  const worst = usage.reduce((max, u) => Math.max(max, u.overnightMinutes), 0);
  if (worst >= 30) return "danger";
  if (worst > 0) return "warn";
  return "ok";
}

export function fmtMinutes(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  if (minutes < 60) return `${Math.round(minutes * 10) / 10}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

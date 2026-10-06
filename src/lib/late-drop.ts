/**
 * Late-drop rule: a confirmed player who leaves within this many minutes of
 * kickoff (or after it) is recorded as a late drop on their attendance profile.
 * The database trigger `log_late_drop` is the source of truth; this mirrors its
 * 2 hour window so the confirmation dialog warns before the player commits.
 */
export const LATE_DROP_WINDOW_MINUTES = 120;

export function isLateDrop(opts: {
  startsAt: string | null | undefined;
  allDay?: boolean | null;
  now?: number;
}): boolean {
  if (!opts.startsAt || opts.allDay) return false;
  const start = new Date(opts.startsAt).getTime();
  if (!Number.isFinite(start)) return false;
  const now = opts.now ?? Date.now();
  return start - now <= LATE_DROP_WINDOW_MINUTES * 60 * 1000;
}

export function lateDropWarning(startsAt: string, now: number = Date.now()): string {
  const started = new Date(startsAt).getTime() <= now;
  const lead = started
    ? "This game has already started."
    : "This game starts in less than 2 hours.";
  return `${lead} Dropping out now leaves your squad short and will be noted on your attendance profile.`;
}

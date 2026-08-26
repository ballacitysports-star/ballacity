/**
 * Multi-day game scheduling: a host picks any set of calendar days and gives
 * each one its own start time. Each entry becomes one hosted game.
 */

export type ScheduleEntry = { date: string; time: string };

export const MAX_SCHEDULE_DAYS = 60;
export const DEFAULT_GAME_TIME = "18:00";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDateKey(v: string): boolean {
  return DATE_RE.test(v) && !Number.isNaN(fromDateKey(v).getTime());
}

export function isValidTime(v: string): boolean {
  return TIME_RE.test(v);
}

export function toDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now);
}

/** Sort by day, drop duplicates and anything malformed, cap the length. */
export function normalizeSchedule(entries: ScheduleEntry[]): ScheduleEntry[] {
  const byDate = new Map<string, ScheduleEntry>();
  for (const e of entries) {
    if (!e || !isValidDateKey(e.date)) continue;
    byDate.set(e.date, { date: e.date, time: isValidTime(e.time) ? e.time : DEFAULT_GAME_TIME });
  }
  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, MAX_SCHEDULE_DAYS);
}

export function toggleScheduleDate(
  entries: ScheduleEntry[],
  date: string,
  fallbackTime = DEFAULT_GAME_TIME,
): ScheduleEntry[] {
  if (!isValidDateKey(date)) return entries;
  if (entries.some((e) => e.date === date)) {
    return normalizeSchedule(entries.filter((e) => e.date !== date));
  }
  if (entries.length >= MAX_SCHEDULE_DAYS) return normalizeSchedule(entries);
  const last = normalizeSchedule(entries).slice(-1)[0];
  return normalizeSchedule([...entries, { date, time: last?.time ?? fallbackTime }]);
}

export function setScheduleTime(
  entries: ScheduleEntry[],
  date: string,
  time: string,
): ScheduleEntry[] {
  return entries.map((e) => (e.date === date ? { ...e, time } : e));
}

export function applyTimeToAll(entries: ScheduleEntry[], time: string): ScheduleEntry[] {
  return entries.map((e) => ({ ...e, time }));
}

/** Human summary shown under the builder. */
export function formatScheduleSummary(entries: ScheduleEntry[]): string {
  const list = normalizeSchedule(entries);
  if (list.length === 0) return "Pick the days you want to host (up to 60).";
  const parts = list.map((e) => `${formatShortDate(e.date)} · ${formatTime(e.time)}`);
  return `Creates ${list.length} game${list.length === 1 ? "" : "s"}: ${parts.join(", ")}`;
}

export function formatShortDate(date: string): string {
  if (!isValidDateKey(date)) return date;
  return fromDateKey(date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatTime(time: string): string {
  if (!isValidTime(time)) return time;
  const [h, m] = time.split(":").map(Number);
  const d = new Date(2000, 0, 1, h ?? 0, m ?? 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export type ScheduleValidation = { ok: boolean; error?: string };

export function validateSchedule(
  entries: ScheduleEntry[],
  now: Date = new Date(),
): ScheduleValidation {
  const list = normalizeSchedule(entries);
  if (list.length === 0) return { ok: false, error: "Pick at least one day to host." };
  const min = todayKey(now);
  if (list.some((e) => e.date < min)) return { ok: false, error: "Remove days in the past." };
  if (entries.some((e) => !isValidTime(e.time)))
    return { ok: false, error: "Every day needs a start time." };
  return { ok: true };
}

/** ISO datetimes for publishing, one per scheduled day. */
export function scheduleToIsoDates(entries: ScheduleEntry[]): string[] {
  return normalizeSchedule(entries).map((e) =>
    new Date(`${e.date}T${e.time}:00`).toISOString(),
  );
}

/** Days of a month grid (weeks start Sunday), padded with nulls. */
export function monthGrid(cursor: Date): (string | null)[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(toDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), d)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** All remaining days of the visible month matching a weekday predicate. */
export function monthDatesMatching(
  cursor: Date,
  match: (weekday: number) => boolean,
  now: Date = new Date(),
): string[] {
  const min = todayKey(now);
  return monthGrid(cursor)
    .filter((k): k is string => !!k && k >= min)
    .filter((k) => match(fromDateKey(k).getDay()));
}

export const isWeekend = (w: number) => w === 0 || w === 6;
export const isWeekday = (w: number) => !isWeekend(w);

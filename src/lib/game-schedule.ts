/**
 * Game scheduling: a host either picks one start → end window (optionally
 * spanning days, optionally all day), or picks any set of calendar days and
 * gives each one its own start and end time. Each day becomes one hosted game.
 */

export type ScheduleEntry = {
  date: string;
  time: string;
  endTime?: string;
  allDay?: boolean;
};

export const MAX_SCHEDULE_DAYS = 60;
export const DEFAULT_GAME_TIME = "18:00";
export const DEFAULT_DURATION_MIN = 90;
export const ALL_DAY_MIN = 24 * 60;

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

export function minutesOfTime(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function timeFromMinutes(total: number): string {
  const wrapped = ((total % ALL_DAY_MIN) + ALL_DAY_MIN) % ALL_DAY_MIN;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(wrapped / 60))}:${p(wrapped % 60)}`;
}

export function addMinutesToTime(time: string, minutes: number): string {
  return timeFromMinutes(minutesOfTime(isValidTime(time) ? time : DEFAULT_GAME_TIME) + minutes);
}

/** Default end time for a start time (start + 90 min). */
export function defaultEndTime(start: string): string {
  return addMinutesToTime(start, DEFAULT_DURATION_MIN);
}

/** Length in minutes; end times at/before the start roll past midnight. */
export function entryDurationMin(entry: ScheduleEntry): number {
  if (entry.allDay) return ALL_DAY_MIN;
  const start = minutesOfTime(isValidTime(entry.time) ? entry.time : DEFAULT_GAME_TIME);
  const endRaw = entry.endTime && isValidTime(entry.endTime) ? minutesOfTime(entry.endTime) : null;
  if (endRaw === null) return DEFAULT_DURATION_MIN;
  const diff = endRaw - start;
  return diff > 0 ? diff : diff + ALL_DAY_MIN;
}

/** Sort by day, drop duplicates and anything malformed, cap the length. */
export function normalizeSchedule(entries: ScheduleEntry[]): ScheduleEntry[] {
  const byDate = new Map<string, ScheduleEntry>();
  for (const e of entries) {
    if (!e || !isValidDateKey(e.date)) continue;
    const time = isValidTime(e.time) ? e.time : DEFAULT_GAME_TIME;
    const endTime = e.endTime && isValidTime(e.endTime) ? e.endTime : defaultEndTime(time);
    byDate.set(e.date, { date: e.date, time, endTime, allDay: !!e.allDay });
  }
  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, MAX_SCHEDULE_DAYS);
}

export function toggleScheduleDate(
  entries: ScheduleEntry[],
  date: string,
  fallback: Partial<ScheduleEntry> | string = {},
): ScheduleEntry[] {
  if (!isValidDateKey(date)) return entries;
  if (entries.some((e) => e.date === date)) {
    return normalizeSchedule(entries.filter((e) => e.date !== date));
  }
  if (entries.length >= MAX_SCHEDULE_DAYS) return normalizeSchedule(entries);
  const fb: Partial<ScheduleEntry> =
    typeof fallback === "string" ? { time: fallback } : (fallback ?? {});
  const last = normalizeSchedule(entries).slice(-1)[0];
  const time = last?.time ?? fb.time ?? DEFAULT_GAME_TIME;
  return normalizeSchedule([
    ...entries,
    {
      date,
      time,
      endTime: last?.endTime ?? fb.endTime ?? defaultEndTime(time),
      allDay: last?.allDay ?? fb.allDay ?? false,
    },
  ]);
}

export function setScheduleTime(
  entries: ScheduleEntry[],
  date: string,
  time: string,
): ScheduleEntry[] {
  return entries.map((e) => {
    if (e.date !== date) return e;
    // Keep the same length when the start moves.
    const keepLength = entryDurationMin(e);
    return { ...e, time, endTime: addMinutesToTime(time, keepLength) };
  });
}

export function setScheduleEndTime(
  entries: ScheduleEntry[],
  date: string,
  endTime: string,
): ScheduleEntry[] {
  return entries.map((e) => (e.date === date ? { ...e, endTime } : e));
}

export function setScheduleAllDay(
  entries: ScheduleEntry[],
  date: string,
  allDay: boolean,
): ScheduleEntry[] {
  return entries.map((e) => (e.date === date ? { ...e, allDay } : e));
}

/** Copy one day's start/end/all-day onto every day. */
export function applyTimeToAll(
  entries: ScheduleEntry[],
  source: Partial<ScheduleEntry> | string,
): ScheduleEntry[] {
  const src: Partial<ScheduleEntry> = typeof source === "string" ? { time: source } : source;
  const time = isValidTime(src.time ?? "") ? src.time! : DEFAULT_GAME_TIME;
  const endTime = src.endTime && isValidTime(src.endTime) ? src.endTime : defaultEndTime(time);
  return entries.map((e) => ({ ...e, time, endTime, allDay: !!src.allDay }));
}

/** Human summary shown under the builder. */
export function formatScheduleSummary(entries: ScheduleEntry[]): string {
  const list = normalizeSchedule(entries);
  if (list.length === 0) return "Pick the days you want to host (up to 60).";
  const parts = list.map((e) =>
    e.allDay
      ? `${formatShortDate(e.date)} · all day`
      : `${formatShortDate(e.date)} · ${formatTimeRange(e)}`,
  );
  return `Creates ${list.length} game${list.length === 1 ? "" : "s"}: ${parts.join(", ")}`;
}

export function formatTimeRange(entry: ScheduleEntry): string {
  if (entry.allDay) return "All day";
  const end = entry.endTime ?? defaultEndTime(entry.time);
  return `${formatTime(entry.time)} – ${formatTime(end)} · ${formatDurationLabel(
    entryDurationMin(entry),
  )}`;
}

export function formatDurationLabel(minutes: number): string {
  if (minutes >= ALL_DAY_MIN) return "All day";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
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
  if (entries.some((e) => !e.allDay && !isValidTime(e.time)))
    return { ok: false, error: "Every day needs a start time." };
  if (entries.some((e) => !e.allDay && e.endTime !== undefined && !isValidTime(e.endTime)))
    return { ok: false, error: "Every day needs an end time." };
  if (list.some((e) => !e.allDay && e.time === e.endTime))
    return { ok: false, error: "End time can't match the start time." };
  return { ok: true };
}

export type GamePlan = { startIso: string; durationMin: number };

/** One start time + length per scheduled day, ready to publish. */
export function scheduleToPlans(entries: ScheduleEntry[]): GamePlan[] {
  return normalizeSchedule(entries).map((e) => ({
    startIso: new Date(`${e.date}T${e.allDay ? "00:00" : e.time}:00`).toISOString(),
    durationMin: entryDurationMin(e),
  }));
}

/** ISO datetimes for publishing, one per scheduled day. */
export function scheduleToIsoDates(entries: ScheduleEntry[]): string[] {
  return scheduleToPlans(entries).map((p) => p.startIso);
}

/** Stored as free text on the game row, e.g. "90 min". */
export function durationToText(minutes: number): string {
  return `${Math.max(1, Math.round(minutes))} min`;
}

// ---------- Single start → end window ----------

export type WhenRange = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
};

export function defaultWhenRange(now: Date = new Date()): WhenRange {
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  start.setMinutes(start.getMinutes() >= 30 ? 30 : 0, 0, 0);
  const startDate = toDateKey(start);
  const startTime = `${String(start.getHours()).padStart(2, "0")}:${String(
    start.getMinutes(),
  ).padStart(2, "0")}`;
  const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60 * 1000);
  return {
    startDate,
    startTime,
    endDate: toDateKey(end),
    endTime: `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`,
    allDay: false,
  };
}

function rangeStart(r: WhenRange): Date {
  return new Date(`${r.startDate}T${r.allDay ? "00:00" : r.startTime}:00`);
}

function rangeEnd(r: WhenRange): Date {
  return r.allDay
    ? new Date(fromDateKey(r.endDate).getTime() + ALL_DAY_MIN * 60 * 1000)
    : new Date(`${r.endDate}T${r.endTime}:00`);
}

/** Length of the window in minutes (all-day spans whole days). */
export function whenRangeDurationMin(r: WhenRange): number {
  const ms = rangeEnd(r).getTime() - rangeStart(r).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_DURATION_MIN;
  return Math.round(ms / 60000);
}

/** Move the end so the window keeps a given length from the current start. */
export function setRangeDuration(r: WhenRange, minutes: number): WhenRange {
  const end = new Date(rangeStart(r).getTime() + minutes * 60 * 1000);
  return {
    ...r,
    endDate: toDateKey(end),
    endTime: `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`,
  };
}

export function validateWhenRange(r: WhenRange, now: Date = new Date()): ScheduleValidation {
  if (!isValidDateKey(r.startDate)) return { ok: false, error: "Pick a start date." };
  if (!isValidDateKey(r.endDate)) return { ok: false, error: "Pick an end date." };
  if (!r.allDay && (!isValidTime(r.startTime) || !isValidTime(r.endTime)))
    return { ok: false, error: "Pick a start and end time." };
  if (r.startDate < todayKey(now)) return { ok: false, error: "Start date is in the past." };
  if (rangeEnd(r).getTime() <= rangeStart(r).getTime())
    return { ok: false, error: "The end must come after the start." };
  return { ok: true };
}

export function whenRangeToPlan(r: WhenRange): GamePlan {
  return { startIso: rangeStart(r).toISOString(), durationMin: whenRangeDurationMin(r) };
}

export function formatWhenRange(r: WhenRange): string {
  if (!isValidDateKey(r.startDate) || !isValidDateKey(r.endDate)) return "Pick when it happens.";
  if (r.allDay) {
    return r.startDate === r.endDate
      ? `All day, ${formatShortDate(r.startDate)}`
      : `All day, ${formatShortDate(r.startDate)} – ${formatShortDate(r.endDate)}`;
  }
  const length = formatDurationLabel(whenRangeDurationMin(r));
  return r.startDate === r.endDate
    ? `${formatShortDate(r.startDate)}, ${formatTime(r.startTime)} – ${formatTime(r.endTime)} · ${length}`
    : `${formatShortDate(r.startDate)} ${formatTime(r.startTime)} – ${formatShortDate(
        r.endDate,
      )} ${formatTime(r.endTime)} · ${length}`;
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

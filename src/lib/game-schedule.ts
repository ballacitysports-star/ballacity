/**
 * Game scheduling on top of the shared date & time engine (`@/lib/datetime`).
 *
 * A host either picks one start → end window (optionally spanning days,
 * optionally all day, optionally repeating), or picks any set of calendar days
 * and gives each one its own start and end time. Each day becomes one hosted
 * game session; sessions of one event share a series id.
 *
 * Wall-clock values (date keys + "HH:mm") are always interpreted in the
 * event's timezone, so a game set for 6pm in Chicago is stored as the correct
 * instant no matter where the host is sitting.
 */

import {
  ALL_DAY_MIN,
  DEFAULT_DURATION_MIN,
  addDaysToKey as addDaysToKeyDt,
  addMinutesToTime as addMinutesToTimeDt,
  dateKeyInZone,
  formatDuration,
  formatTimeKey,
  friendlyDayLabelKey,
  isDateKey,
  isTimeKey,
  minutesOfTime as minutesOfTimeDt,
  resolveTimeZone,
  timeFromMinutes as timeFromMinutesDt,
  timeKeyInZone,
  todayKeyInZone,
  weekdayOfKey,
  WEEKDAY_LABELS,
  zonedTimeToInstant,
} from "@/lib/datetime";
import { expandRecurrence, type RecurrenceRule } from "@/lib/recurrence";

export type ScheduleEntry = {
  date: string;
  time: string;
  endTime?: string;
  allDay?: boolean;
};

export const MAX_SCHEDULE_DAYS = 60;
export const DEFAULT_GAME_TIME = "18:00";
export { ALL_DAY_MIN, DEFAULT_DURATION_MIN };

// ---------- re-exported primitives (single source of truth) ----------

export const isValidDateKey = isDateKey;
export const isValidTime = isTimeKey;
export const addDaysToKey = addDaysToKeyDt;
export const minutesOfTime = minutesOfTimeDt;
export const timeFromMinutes = timeFromMinutesDt;
export const addMinutesToTime = addMinutesToTimeDt;

export function toDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Today, in the event's timezone. */
export function todayKey(nowOrTz: Date | string = new Date(), tz?: string | null): string {
  if (typeof nowOrTz === "string") return todayKeyInZone(nowOrTz);
  return todayKeyInZone(tz, nowOrTz);
}

/** The next occurrence of a weekday (0=Sun) strictly after today. */
export function nextWeekdayKey(weekday: number, now: Date = new Date()): string {
  const base = todayKey(now);
  for (let i = 1; i <= 7; i++) {
    const key = addDaysToKey(base, i);
    if (weekdayOfKey(key) === weekday) return key;
  }
  return base;
}

/** Short weekday label for a date key, e.g. "Sat". */
export function weekdayLabel(key: string): string {
  return WEEKDAY_LABELS[weekdayOfKey(key)];
}

/** Friendly day label: Today / Tomorrow / "Sat, Sep 5". */
export function friendlyDayLabel(key: string, now: Date = new Date()): string {
  return friendlyDayLabelKey(key, todayKey(now));
}

export function defaultEndTime(start: string): string {
  return addMinutesToTime(start, DEFAULT_DURATION_MIN);
}

export function formatDurationLabel(minutes: number): string {
  return formatDuration(minutes);
}

export function formatShortDate(date: string): string {
  return isDateKey(date) ? friendlyDayLabelKey(date, "") : date;
}

export function formatTime(time: string): string {
  return formatTimeKey(time);
}

// ---------- multi-day schedule (one entry per day) ----------

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

export type ScheduleValidation = { ok: boolean; error?: string };

export function validateSchedule(
  entries: ScheduleEntry[],
  now: Date = new Date(),
  tz?: string | null,
): ScheduleValidation {
  const list = normalizeSchedule(entries);
  if (list.length === 0) return { ok: false, error: "Pick at least one day to host." };
  const min = todayKey(now, tz);
  if (list.some((e) => e.date < min)) return { ok: false, error: "Remove days in the past." };
  if (entries.some((e) => !e.allDay && !isValidTime(e.time)))
    return { ok: false, error: "Every day needs a start time." };
  if (entries.some((e) => !e.allDay && e.endTime !== undefined && !isValidTime(e.endTime)))
    return { ok: false, error: "Every day needs an end time." };
  if (list.some((e) => !e.allDay && e.time === e.endTime))
    return { ok: false, error: "End time can't match the start time." };
  return { ok: true };
}

/** One publishable session. */
export type GamePlan = {
  startIso: string;
  endIso: string;
  durationMin: number;
  allDay: boolean;
  timezone: string;
};

function entryToPlan(entry: ScheduleEntry, tz: string): GamePlan {
  const durationMin = entryDurationMin(entry);
  const start = zonedTimeToInstant(entry.date, entry.allDay ? "00:00" : entry.time, tz);
  return {
    startIso: start.toISOString(),
    endIso: new Date(start.getTime() + durationMin * 60_000).toISOString(),
    durationMin,
    allDay: !!entry.allDay,
    timezone: tz,
  };
}

/** One start time + length per scheduled day, ready to publish. */
export function scheduleToPlans(entries: ScheduleEntry[], tz?: string | null): GamePlan[] {
  const zone = resolveTimeZone(tz);
  return normalizeSchedule(entries).map((e) => entryToPlan(e, zone));
}

/** ISO datetimes for publishing, one per scheduled day. */
export function scheduleToIsoDates(entries: ScheduleEntry[], tz?: string | null): string[] {
  return scheduleToPlans(entries, tz).map((p) => p.startIso);
}

/** Stored as free text on the game row, e.g. "90 min". */
export function durationToText(minutes: number): string {
  return `${Math.max(1, Math.round(minutes))} min`;
}

// ---------- single start → end window ----------

export type WhenRange = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
};

export function defaultWhenRange(now: Date = new Date(), tz?: string | null): WhenRange {
  const zone = resolveTimeZone(tz);
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  start.setMinutes(start.getMinutes() >= 30 ? 30 : 0, 0, 0);
  const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60 * 1000);
  return {
    startDate: dateKeyInZone(start, zone),
    startTime: timeKeyInZone(start, zone),
    endDate: dateKeyInZone(end, zone),
    endTime: timeKeyInZone(end, zone),
    allDay: false,
  };
}

/** Length of the window in minutes, from the wall-clock fields. */
export function rangeLengthMin(r: WhenRange): number {
  if (r.allDay) {
    const days = Math.max(0, dayGap(r.startDate, r.endDate)) + 1;
    return days * ALL_DAY_MIN;
  }
  const dayMinutes = dayGap(r.startDate, r.endDate) * ALL_DAY_MIN;
  const diff = dayMinutes + minutesOfTime(r.endTime) - minutesOfTime(r.startTime);
  return diff > 0 ? diff : DEFAULT_DURATION_MIN;
}

/** Kept for compatibility with earlier call sites. */
export const whenRangeDurationMin = rangeLengthMin;

function dayGap(a: string, b: string): number {
  if (!isValidDateKey(a) || !isValidDateKey(b)) return 0;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Move the end so the window keeps a given length from the current start. */
export function setRangeDuration(r: WhenRange, minutes: number): WhenRange {
  const total = minutesOfTime(r.startTime) + minutes;
  return {
    ...r,
    endDate: addDaysToKey(r.startDate, Math.floor(total / ALL_DAY_MIN)),
    endTime: timeFromMinutes(total),
  };
}

export function validateWhenRange(
  r: WhenRange,
  now: Date = new Date(),
  tz?: string | null,
): ScheduleValidation {
  if (!isValidDateKey(r.startDate)) return { ok: false, error: "Pick a start date." };
  if (!isValidDateKey(r.endDate)) return { ok: false, error: "Pick an end date." };
  if (!r.allDay && (!isValidTime(r.startTime) || !isValidTime(r.endTime)))
    return { ok: false, error: "Pick a start and end time." };
  if (r.startDate < todayKey(now, tz)) return { ok: false, error: "Start date is in the past." };
  if (r.endDate < r.startDate) return { ok: false, error: "The end must come after the start." };
  if (!r.allDay && rangeLengthMin(r) <= 0)
    return { ok: false, error: "The end must come after the start." };
  if (!r.allDay && r.startDate === r.endDate && r.startTime === r.endTime)
    return { ok: false, error: "End time can't match the start time." };
  return { ok: true };
}

export function whenRangeToPlan(r: WhenRange, tz?: string | null): GamePlan {
  const zone = resolveTimeZone(tz);
  const durationMin = rangeLengthMin(r);
  const start = zonedTimeToInstant(r.startDate, r.allDay ? "00:00" : r.startTime, zone);
  return {
    startIso: start.toISOString(),
    endIso: new Date(start.getTime() + durationMin * 60_000).toISOString(),
    durationMin,
    allDay: r.allDay,
    timezone: zone,
  };
}

/**
 * Expand a repeating window into one plan per occurrence. Every occurrence
 * keeps the same length and time of day as the first.
 */
export function whenRangeToPlans(
  r: WhenRange,
  rule: RecurrenceRule,
  tz?: string | null,
): GamePlan[] {
  const zone = resolveTimeZone(tz);
  if (rule.freq === "none") return [whenRangeToPlan(r, zone)];
  const durationMin = rangeLengthMin(r);
  return expandRecurrence(r.startDate, rule).map((key) => {
    const start = zonedTimeToInstant(key, r.allDay ? "00:00" : r.startTime, zone);
    return {
      startIso: start.toISOString(),
      endIso: new Date(start.getTime() + durationMin * 60_000).toISOString(),
      durationMin,
      allDay: r.allDay,
      timezone: zone,
    };
  });
}

export function formatWhenRange(r: WhenRange): string {
  if (!isValidDateKey(r.startDate) || !isValidDateKey(r.endDate)) return "Pick when it happens.";
  if (r.allDay) {
    return r.startDate === r.endDate
      ? `All day, ${formatShortDate(r.startDate)}`
      : `All day, ${formatShortDate(r.startDate)} – ${formatShortDate(r.endDate)}`;
  }
  const length = formatDurationLabel(rangeLengthMin(r));
  return r.startDate === r.endDate
    ? `${formatShortDate(r.startDate)}, ${formatTime(r.startTime)} – ${formatTime(r.endTime)} · ${length}`
    : `${formatShortDate(r.startDate)} ${formatTime(r.startTime)} – ${formatShortDate(
        r.endDate,
      )} ${formatTime(r.endTime)} · ${length}`;
}

/** Turn a range into per-day entries, so hosts can switch modes losslessly. */
export function whenRangeToSchedule(r: WhenRange): ScheduleEntry[] {
  const days = Math.max(0, dayGap(r.startDate, r.endDate));
  const endTime = r.allDay ? undefined : r.endTime;
  if (days === 0) {
    return normalizeSchedule([{ date: r.startDate, time: r.startTime, endTime, allDay: r.allDay }]);
  }
  return normalizeSchedule(
    Array.from({ length: days + 1 }, (_, i) => ({
      date: addDaysToKey(r.startDate, i),
      time: r.startTime,
      endTime: endTime ?? defaultEndTime(r.startTime),
      allDay: r.allDay,
    })),
  );
}

// ---------- month grid helpers (kept for existing call sites) ----------

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
    .filter((k) => match(weekdayOfKey(k)));
}

export const isWeekend = (w: number) => w === 0 || w === 6;
export const isWeekday = (w: number) => !isWeekend(w);

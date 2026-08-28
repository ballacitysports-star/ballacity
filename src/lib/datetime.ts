/**
 * The app's single source of truth for date & time.
 *
 * Every scheduled thing in BallaCity (games, availability, sessions, posts,
 * gym hours) is described by the same shape: a start instant, an end instant,
 * an all-day flag and the timezone the event happens in. All labels are
 * rendered in the *event's* timezone so a game in Chicago reads in Chicago
 * time no matter where the viewer sits, with an optional "your time" hint.
 *
 * Formatting is deliberately Intl-based with an explicit timeZone, which makes
 * SSR and client output identical (no hydration drift).
 */

export const DEFAULT_TIME_ZONE = "America/New_York";
export const ALL_DAY_MIN = 24 * 60;
export const DEFAULT_DURATION_MIN = 90;
export const MINUTE_MS = 60_000;

/** Canonical description of "when" something happens. */
export type EventWhen = {
  /** ISO start instant. */
  start: string;
  /** ISO end instant. Falls back to start + DEFAULT_DURATION_MIN. */
  end?: string | null;
  /** True when the event covers whole days rather than a time window. */
  allDay?: boolean | null;
  /** IANA zone the event happens in, e.g. "America/Chicago". */
  timezone?: string | null;
  /** Minutes players should arrive before the start. */
  arriveEarlyMin?: number | null;
};

// ---------------------------------------------------------------- zones

let cachedDeviceZone: string | null = null;

/** The viewer's IANA timezone (falls back to the app default). */
export function deviceTimeZone(): string {
  if (cachedDeviceZone) return cachedDeviceZone;
  try {
    cachedDeviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
  } catch {
    cachedDeviceZone = DEFAULT_TIME_ZONE;
  }
  return cachedDeviceZone;
}

export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Resolve a stored zone, falling back to the device and then the app default. */
export function resolveTimeZone(tz?: string | null): string {
  if (isValidTimeZone(tz)) return tz!;
  const device = deviceTimeZone();
  return isValidTimeZone(device) ? device : DEFAULT_TIME_ZONE;
}

/** Short zone label, e.g. "EDT". */
export function timeZoneAbbr(at: Date | string | number, tz?: string | null): string {
  const zone = resolveTimeZone(tz);
  const d = toDate(at);
  if (!isValidDate(d)) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "short",
    }).formatToParts(d);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- primitives

export function toDate(v: Date | string | number): Date {
  return v instanceof Date ? v : new Date(v);
}

export function isValidDate(d: Date): boolean {
  return d instanceof Date && Number.isFinite(d.getTime());
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isDateKey = (v: string) => DATE_RE.test(v);
export const isTimeKey = (v: string) => TIME_RE.test(v);

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" for a date, read in a specific zone. */
export function dateKeyInZone(at: Date | string | number, tz?: string | null): string {
  const d = toDate(at);
  if (!isValidDate(d)) return "";
  const p = zonedParts(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "HH:mm" for a date, read in a specific zone. */
export function timeKeyInZone(at: Date | string | number, tz?: string | null): string {
  const d = toDate(at);
  if (!isValidDate(d)) return "";
  const p = zonedParts(d, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Calendar fields of an instant as seen in a zone. */
export function zonedParts(at: Date | string | number, tz?: string | null): Parts {
  const d = toDate(at);
  const zone = resolveTimeZone(tz);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const out: Record<string, number> = {};
  for (const part of fmt.formatToParts(d)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** Offset (minutes) of a zone at a given instant. */
export function zoneOffsetMin(at: Date | string | number, tz?: string | null): number {
  const d = toDate(at);
  const p = zonedParts(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - d.getTime()) / MINUTE_MS);
}

/**
 * Build the instant for a wall-clock date+time *in a zone*.
 * Handles DST by resolving the offset twice.
 */
export function zonedTimeToInstant(dateKey: string, timeKey: string, tz?: string | null): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = (isTimeKey(timeKey) ? timeKey : "00:00").split(":").map(Number);
  const naive = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  let guess = new Date(naive - zoneOffsetMin(new Date(naive), tz) * MINUTE_MS);
  guess = new Date(naive - zoneOffsetMin(guess, tz) * MINUTE_MS);
  return guess;
}

/** Shift a "YYYY-MM-DD" key by whole days (zone-independent). */
export function addDaysToKey(key: string, days: number): string {
  if (!isDateKey(key)) return key;
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Weekday index (0=Sun) of a date key. */
export function weekdayOfKey(key: string): number {
  if (!isDateKey(key)) return 0;
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** Today's date key in a zone. */
export function todayKeyInZone(tz?: string | null, now: Date = new Date()): string {
  return dateKeyInZone(now, tz);
}

export function minutesOfTime(time: string): number {
  const [h, m] = (isTimeKey(time) ? time : "00:00").split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function timeFromMinutes(total: number): string {
  const wrapped = ((total % ALL_DAY_MIN) + ALL_DAY_MIN) % ALL_DAY_MIN;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

export function addMinutesToTime(time: string, minutes: number): string {
  return timeFromMinutes(minutesOfTime(time) + minutes);
}

// ---------------------------------------------------------------- windows

/** Resolved instants for an EventWhen. */
export function whenBounds(when: EventWhen): { start: Date; end: Date } {
  const start = toDate(when.start);
  if (!isValidDate(start)) {
    const now = new Date();
    return { start: now, end: new Date(now.getTime() + DEFAULT_DURATION_MIN * MINUTE_MS) };
  }
  const raw = when.end ? toDate(when.end) : null;
  const end =
    raw && isValidDate(raw) && raw.getTime() > start.getTime()
      ? raw
      : new Date(
          start.getTime() +
            (when.allDay ? ALL_DAY_MIN : DEFAULT_DURATION_MIN) * MINUTE_MS,
        );
  return { start, end };
}

export function whenDurationMin(when: EventWhen): number {
  const { start, end } = whenBounds(when);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / MINUTE_MS));
}

export function whenSpansDays(when: EventWhen): boolean {
  const { start, end } = whenBounds(when);
  const tz = when.timezone;
  return dateKeyInZone(start, tz) !== dateKeyInZone(when.allDay ? end.getTime() - 1 : end, tz);
}

/** Time players should show up (start minus arrive-early buffer). */
export function whenArrivalTime(when: EventWhen): Date {
  const { start } = whenBounds(when);
  const buf = Math.max(0, when.arriveEarlyMin ?? 0);
  return buf ? new Date(start.getTime() - buf * MINUTE_MS) : start;
}

// ---------------------------------------------------------------- labels

function fmt(at: Date, tz: string | null | undefined, opts: Intl.DateTimeFormatOptions): string {
  const d = toDate(at);
  if (!isValidDate(d)) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: resolveTimeZone(tz), ...opts }).format(d);
}

/** "6:00 PM" */
export function formatTimeOfDay(at: Date | string | number, tz?: string | null): string {
  return fmt(toDate(at), tz, { hour: "numeric", minute: "2-digit" });
}

/** "Sat, Sep 5" */
export function formatDay(at: Date | string | number, tz?: string | null): string {
  return fmt(toDate(at), tz, { weekday: "short", month: "short", day: "numeric" });
}

/** "Sat, Sep 5, 2026" */
export function formatFullDay(at: Date | string | number, tz?: string | null): string {
  return fmt(toDate(at), tz, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "6:00 – 7:30 PM" (drops the repeated meridiem when it matches). */
export function formatTimeRange(
  start: Date | string | number,
  end: Date | string | number,
  tz?: string | null,
): string {
  const a = formatTimeOfDay(start, tz);
  const b = formatTimeOfDay(end, tz);
  const mA = a.slice(-2);
  const mB = b.slice(-2);
  if (mA === mB) return `${a.slice(0, -3)} – ${b}`;
  return `${a} – ${b}`;
}

/** "1h 30m" / "All day" */
export function formatDuration(minutes: number): string {
  if (minutes >= ALL_DAY_MIN && minutes % ALL_DAY_MIN === 0) {
    const days = minutes / ALL_DAY_MIN;
    return days === 1 ? "All day" : `${days} days`;
  }
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "Today" / "Tomorrow" / "Yesterday" / "Sat, Sep 5" */
export function formatRelativeDay(
  at: Date | string | number,
  tz?: string | null,
  now: Date = new Date(),
): string {
  const key = dateKeyInZone(at, tz);
  const today = dateKeyInZone(now, tz);
  if (!key) return "";
  if (key === today) return "Today";
  if (key === addDaysToKey(today, 1)) return "Tomorrow";
  if (key === addDaysToKey(today, -1)) return "Yesterday";
  const days = daysBetweenKeys(today, key);
  if (days > 1 && days <= 6) return fmt(toDate(at), tz, { weekday: "long" });
  const sameYear = zonedParts(at, tz).year === zonedParts(now, tz).year;
  return sameYear ? formatDay(at, tz) : formatFullDay(at, tz);
}

export function daysBetweenKeys(from: string, to: string): number {
  if (!isDateKey(from) || !isDateKey(to)) return 0;
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** "in 3 days" / "in 2h" / "5m ago" */
export function formatRelativeTime(at: Date | string | number, now: Date = new Date()): string {
  const d = toDate(at);
  if (!isValidDate(d)) return "";
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / MINUTE_MS);
  const label =
    mins < 1
      ? "now"
      : mins < 60
        ? `${mins}m`
        : abs < 86_400_000
          ? formatDuration(mins)
          : `${Math.round(abs / 86_400_000)}d`;
  if (label === "now") return "now";
  return diff > 0 ? `in ${label}` : `${label} ago`;
}

/** Countdown to an instant: "2d 4h", "3h 20m", "12m", "" once passed. */
export function formatCountdown(at: Date | string | number, now: Date = new Date()): string {
  const d = toDate(at);
  if (!isValidDate(d)) return "";
  let secs = Math.floor((d.getTime() - now.getTime()) / 1000);
  if (secs <= 0) return "";
  const days = Math.floor(secs / 86400);
  secs -= days * 86400;
  const hours = Math.floor(secs / 3600);
  secs -= hours * 3600;
  const mins = Math.floor(secs / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * The canonical "when" line, e.g.
 *   "Today · 6:00 – 7:30 PM EDT"
 *   "Sat, Sep 5 · All day"
 *   "Sat, Sep 5 6:00 PM – Sun, Sep 6 1:00 AM EDT"
 */
export function formatEventWhen(
  when: EventWhen,
  opts: { withZone?: boolean; withDuration?: boolean; now?: Date } = {},
): string {
  const { start, end } = whenBounds(when);
  const tz = when.timezone;
  const now = opts.now ?? new Date();
  const day = formatRelativeDay(start, tz, now);
  const zone = opts.withZone === false ? "" : ` ${timeZoneAbbr(start, tz)}`.trimEnd();

  if (when.allDay) {
    const lastDayKey = dateKeyInZone(new Date(end.getTime() - 1), tz);
    const startKey = dateKeyInZone(start, tz);
    if (lastDayKey !== startKey) {
      return `${day} – ${formatDay(zonedTimeToInstant(lastDayKey, "12:00", tz), tz)} · All day`;
    }
    return `${day} · All day`;
  }

  const length =
    opts.withDuration === false ? "" : ` · ${formatDuration(whenDurationMin(when))}`;

  if (whenSpansDays(when)) {
    return `${day} ${formatTimeOfDay(start, tz)} – ${formatDay(end, tz)} ${formatTimeOfDay(
      end,
      tz,
    )}${zone}`;
  }
  return `${day} · ${formatTimeRange(start, end, tz)}${zone}${length}`;
}

/** Compact label for cards: "Today · 6:00 PM". */
export function formatWhenShort(when: EventWhen, now: Date = new Date()): string {
  const { start } = whenBounds(when);
  const tz = when.timezone;
  if (when.allDay) return `${formatRelativeDay(start, tz, now)} · All day`;
  return `${formatRelativeDay(start, tz, now)} · ${formatTimeOfDay(start, tz)}`;
}

/** "9:00 PM your time" when the viewer's zone differs; "" otherwise. */
export function viewerTimeNote(when: EventWhen, viewerZone: string = deviceTimeZone()): string {
  const eventZone = resolveTimeZone(when.timezone);
  const { start, end } = whenBounds(when);
  if (resolveTimeZone(viewerZone) === eventZone) return "";
  if (zoneOffsetMin(start, viewerZone) === zoneOffsetMin(start, eventZone)) return "";
  if (when.allDay) return "";
  return `${formatTimeRange(start, end, viewerZone)} your time`;
}

/** "Ended 2h ago" / "Starts in 3h" / "Happening now". */
export function formatWhenStatus(when: EventWhen, now: Date = new Date()): string {
  const { start, end } = whenBounds(when);
  if (now.getTime() < start.getTime()) return `Starts ${formatRelativeTime(start, now)}`;
  if (now.getTime() <= end.getTime()) return "Happening now";
  return `Ended ${formatRelativeTime(end, now)}`;
}

// ---------------------------------------------------------------- deadlines

/** Deadline expressed relative to the start, or pinned to an instant. */
export type Deadline =
  | { kind: "none" }
  | { kind: "relative"; minutesBefore: number }
  | { kind: "absolute"; at: string };

export const RELATIVE_DEADLINE_PRESETS = [
  { label: "At start", min: 0 },
  { label: "30 min before", min: 30 },
  { label: "2 hours before", min: 120 },
  { label: "6 hours before", min: 360 },
  { label: "1 day before", min: 1440 },
  { label: "2 days before", min: 2880 },
  { label: "1 week before", min: 10080 },
] as const;

export const REMINDER_PRESETS = [
  { label: "1 week before", min: 10080 },
  { label: "1 day before", min: 1440 },
  { label: "2 hours before", min: 120 },
  { label: "30 min before", min: 30 },
] as const;

export function resolveDeadline(when: EventWhen, deadline: Deadline): Date | null {
  if (deadline.kind === "none") return null;
  if (deadline.kind === "absolute") {
    const d = toDate(deadline.at);
    return isValidDate(d) ? d : null;
  }
  const { start } = whenBounds(when);
  return new Date(start.getTime() - Math.max(0, deadline.minutesBefore) * MINUTE_MS);
}

export function formatDeadline(when: EventWhen, deadline: Deadline): string {
  if (deadline.kind === "none") return "No deadline";
  const at = resolveDeadline(when, deadline);
  if (!at) return "No deadline";
  if (deadline.kind === "relative" && deadline.minutesBefore === 0) return "At start time";
  const rel =
    deadline.kind === "relative"
      ? `${formatDuration(deadline.minutesBefore)} before · `
      : "";
  return `${rel}${formatRelativeDay(at, when.timezone)} ${formatTimeOfDay(at, when.timezone)}`;
}

export function isDeadlinePassed(
  when: EventWhen,
  deadline: Deadline,
  now: Date = new Date(),
): boolean {
  const at = resolveDeadline(when, deadline);
  return !!at && at.getTime() < now.getTime();
}

// ---------------------------------------------------------------- conflicts

export type Interval = { start: number; end: number };

export function whenToInterval(when: EventWhen): Interval {
  const { start, end } = whenBounds(when);
  return { start: start.getTime(), end: end.getTime() };
}

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Any existing windows the candidate overlaps. */
export function findConflicts<T extends EventWhen>(candidate: EventWhen, existing: T[]): T[] {
  const c = whenToInterval(candidate);
  return existing.filter((e) => intervalsOverlap(c, whenToInterval(e)));
}

// ---------------------------------------------------------------- calendar export

function icsStamp(at: Date | string | number): string {
  const d = toDate(at);
  return `${d.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

function icsEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);
}

export type CalendarEvent = EventWhen & {
  title: string;
  description?: string;
  location?: string;
  url?: string;
  uid?: string;
  /** Directions link (Google/Apple Maps) added to the invite body. */
  mapUrl?: string;
  /** Coordinates, emitted as an ics GEO property so map apps can pin it. */
  geo?: { lat: number; lng: number } | null;
};

/** Invite body: description + directions + event link, in that order. */
function calendarBody(event: CalendarEvent): string {
  return [event.description, event.mapUrl ? `Directions: ${event.mapUrl}` : null, event.url]
    .filter(Boolean)
    .join("\n\n");
}

/** A full .ics document for one event. */
export function buildIcs(event: CalendarEvent): string {
  const { start, end } = whenBounds(event);
  const uid = event.uid ?? `${icsStamp(start)}-ballacity`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BallaCity//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    event.allDay
      ? `DTSTART;VALUE=DATE:${dateKeyInZone(start, event.timezone).replace(/-/g, "")}`
      : `DTSTART:${icsStamp(start)}`,
    event.allDay
      ? `DTEND;VALUE=DATE:${dateKeyInZone(end, event.timezone).replace(/-/g, "")}`
      : `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(event.title)}`,
  ];
  if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`);
  const body = calendarBody(event);
  if (body) lines.push(`DESCRIPTION:${icsEscape(body)}`);
  if (event.geo && Number.isFinite(event.geo.lat) && Number.isFinite(event.geo.lng)) {
    lines.push(`GEO:${event.geo.lat};${event.geo.lng}`);
  }
  if (event.url) lines.push(`URL:${icsEscape(event.url)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

/** Google Calendar "add event" link. */
export function googleCalendarUrl(event: CalendarEvent): string {
  const { start, end } = whenBounds(event);
  const dates = event.allDay
    ? `${dateKeyInZone(start, event.timezone).replace(/-/g, "")}/${dateKeyInZone(
        end,
        event.timezone,
      ).replace(/-/g, "")}`
    : `${icsStamp(start)}/${icsStamp(end)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates,
    ctz: resolveTimeZone(event.timezone),
  });
  if (event.location) params.set("location", event.location);
  const details = [event.description, event.url].filter(Boolean).join("\n\n");
  if (details) params.set("details", details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Outlook Web "add event" link. */
export function outlookCalendarUrl(event: CalendarEvent): string {
  const { start, end } = whenBounds(event);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
  });
  if (event.allDay) params.set("allday", "true");
  if (event.location) params.set("location", event.location);
  if (event.description) params.set("body", event.description);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/** Trigger a browser download of the .ics file (client-only). */
export function downloadIcs(event: CalendarEvent, filename = "event.ics"): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([buildIcs(event)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- month grid

/** Weeks (Sunday first) of the month containing `cursor`, padded with nulls. */
export function monthGridKeys(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${pad(month + 1)}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** "Sep 2026" heading for a month cursor. */
export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month, 1)));
}

/** Friendly single-day label for a date key: Today / Tomorrow / "Sat, Sep 5". */
export function friendlyDayLabelKey(key: string, todayKey: string): string {
  if (!isDateKey(key)) return key;
  if (key === todayKey) return "Today";
  if (key === addDaysToKey(todayKey, 1)) return "Tomorrow";
  if (key === addDaysToKey(todayKey, -1)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}

/** "6:00 PM" from a "HH:mm" key. */
export function formatTimeKey(time: string): string {
  if (!isTimeKey(time)) return time;
  const [h, m] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, 0, 1, h ?? 0, m ?? 0)));
}

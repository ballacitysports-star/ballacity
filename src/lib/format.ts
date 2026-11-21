// Use a fixed timezone and day anchor so SSR and client hydration render identically.
// The app is NYC-centric, so we display everything in America/New_York.
const TZ = "America/New_York";
const HOUR_MS = 3600_000;

function dayAnchorMs() {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return d.getTime();
}

/** "Sat, Sep 5" in the app's zone. */
function dayLabel(d: Date) {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: TZ,
  });
}

/** "6:00 PM" in the app's zone. */
function timeLabel(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

export function formatWhen(iso: string) {
  const d = new Date(iso);
  const time = timeLabel(d);
  const hrs = Math.round((d.getTime() - dayAnchorMs()) / HOUR_MS);
  if (hrs < 24 && hrs >= 0) return `Today · ${time}`;
  if (hrs < 48 && hrs >= 0) return `Tomorrow · ${time}`;
  return `${dayLabel(d)} · ${time}`;
}

/** Date-only "when" line (no time), used for all-day events. */
export function formatWhenDate(iso: string) {
  const d = new Date(iso);
  const hrs = Math.round((d.getTime() - dayAnchorMs()) / HOUR_MS);
  if (hrs < 24 && hrs >= 0) return `Today`;
  if (hrs < 48 && hrs >= 0) return `Tomorrow`;
  return dayLabel(d);
}

/** Minimal shape needed to format an event's "when" line. */
export type WhenLike = { date: string; allDay?: boolean | null };

/**
 * Canonical "when" line for games. All-day events never show a clock time —
 * they render as the date plus an "All day" marker instead.
 */
export function formatGameWhen(game: WhenLike): string {
  return game.allDay ? `${formatWhenDate(game.date)} · All day` : formatWhen(game.date);
}

/** Minimal shape needed to format an event's "ends" line. */
export type EndsLike = WhenLike & { duration?: string | null; endsAt?: string | null };

/**
 * Canonical "ends" line for games. All-day events never show a clock time —
 * they render the end date only (falling back to the start date).
 */
export function formatGameEnds(game: EndsLike): string {
  const start = new Date(game.date).getTime();
  let end = Number.POSITIVE_INFINITY;
  if (game.endsAt) {
    const e = new Date(game.endsAt).getTime();
    if (Number.isFinite(e) && e > start) end = e;
  }
  if (!Number.isFinite(end) && game.duration) {
    const m = /(\d+(?:\.\d+)?)\s*(h|hour|hr|m|min)/i.exec(game.duration);
    if (m && Number.isFinite(start)) {
      const n = Number(m[1]);
      const mins = /^h/i.test(m[2]!) ? n * 60 : n;
      end = start + mins * 60_000;
    }
  }
  if (game.allDay) {
    const iso = Number.isFinite(end) ? new Date(end).toISOString() : game.date;
    return formatWhenDate(iso);
  }
  if (!Number.isFinite(end)) return game.duration ?? "—";
  return formatWhen(new Date(end).toISOString());
}

/**
 * Notification body "when" line. All-day games show the date only, never a time.
 */
export function formatNotificationWhen(game: WhenLike): string {
  return game.allDay ? `${formatWhenDate(game.date)} (all day)` : formatWhen(game.date);
}

/**
 * Notification "when" line that names the weekday and date and never says "Today" or
 * "Tomorrow", for text read away from the app, such as a push on a lock screen. formatWhen
 * counts days from noon UTC, so on a New York evening its "Today" is already tomorrow. Same
 * format and zone (America/New_York) as the app's other game times, whatever zone the server
 * runs in. All-day games show the date only.
 */
export function formatDatedWhen(game: WhenLike): string {
  const d = new Date(game.date);
  return game.allDay ? `${dayLabel(d)} (all day)` : `${dayLabel(d)} · ${timeLabel(d)}`;
}

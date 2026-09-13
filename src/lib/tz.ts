/**
 * Timezone utilities backed by `Intl.DateTimeFormat` — no external deps.
 *
 * All availability windows and booking slots for trainers are stored as
 * "wall time" in the trainer's IANA timezone (e.g. `America/New_York`).
 * These helpers convert between wall time and real UTC instants so we can
 * display the trainer's schedule in any viewer's local timezone.
 */
import type { Weekday } from "./availability-resolve";

export type Tz = string; // IANA name, e.g. "America/Los_Angeles"

const WEEKDAY_MAP: Record<string, Weekday> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

/** Browser's best guess of the user's IANA timezone. Safe default fallback. */
export function getBrowserTz(): Tz {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

/** Short tz label (e.g. "PDT", "EDT") for the given instant, or the raw name on failure. */
export function tzShortName(instant: Date, tz: Tz): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(instant);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

/** Offset from UTC (in minutes) for the given tz at a specific instant, positive east of UTC. */
function tzOffsetMinutes(instant: Date, tz: Tz): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf
      .formatToParts(instant)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUTC - instant.getTime()) / 60000;
}

/**
 * Convert a wall time (YYYY-MM-DD + HH:MM) in `tz` to a real UTC instant.
 * Handles DST correctly via a two-pass refinement.
 */
export function wallTimeToInstant(dateKey: string, hhmm: string, tz: Tz): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guessUTC = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = tzOffsetMinutes(new Date(guessUTC), tz);
  const utc1 = guessUTC - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(utc1), tz);
  return new Date(guessUTC - off2 * 60000);
}

/** Convert a real UTC instant to wall time (date + HH:MM + weekday) in the target tz. */
export function instantToWall(
  instant: Date,
  tz: Tz,
): { dateKey: string; hhmm: string; weekday: Weekday; hourNum: number; minuteNum: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    dtf
      .formatToParts(instant)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${parts.hour}:${parts.minute}`,
    weekday: WEEKDAY_MAP[parts.weekday] ?? "mon",
    hourNum: Number(parts.hour),
    minuteNum: Number(parts.minute),
  };
}

/** Format a 24h "HH:MM" as US 12h "h:mm AM/PM". */
export function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = (h ?? 0) < 12 ? "AM" : "PM";
  const hr = (h ?? 0) % 12 || 12;
  return `${hr}:${String(m ?? 0).padStart(2, "0")} ${ampm}`;
}

/** Convert a trainer wall-clock time to the equivalent viewer wall-clock time. */
export function convertWall(
  dateKey: string,
  hhmm: string,
  fromTz: Tz,
  toTz: Tz,
): { dateKey: string; hhmm: string } {
  const instant = wallTimeToInstant(dateKey, hhmm, fromTz);
  const wall = instantToWall(instant, toTz);
  return { dateKey: wall.dateKey, hhmm: wall.hhmm };
}

/** Whole-hour offset difference between two zones at a given instant. Positive = fromTz is ahead. */
export function offsetHoursDiff(fromTz: Tz, toTz: Tz, at: Date = new Date()): number {
  const diff = tzOffsetMinutes(at, fromTz) - tzOffsetMinutes(at, toTz);
  return Math.round(diff / 60);
}

/** Human-friendly relative label between two tzs (e.g. "3h ahead of you"). */
export function tzRelativeLabel(trainerTz: Tz, viewerTz: Tz): string | null {
  if (!trainerTz || !viewerTz || trainerTz === viewerTz) return null;
  const diff = offsetHoursDiff(trainerTz, viewerTz);
  if (diff === 0) return "same time as you";
  return `${Math.abs(diff)}h ${diff > 0 ? "ahead of" : "behind"} you`;
}

/** Curated timezone list for the picker (broad, IANA canonical). */
export const TZ_OPTIONS: { group: string; zones: { value: Tz; label: string }[] }[] = [
  {
    group: "Americas",
    zones: [
      { value: "America/Anchorage", label: "Anchorage" },
      { value: "America/Los_Angeles", label: "Los Angeles / Pacific" },
      { value: "America/Denver", label: "Denver / Mountain" },
      { value: "America/Phoenix", label: "Phoenix (no DST)" },
      { value: "America/Chicago", label: "Chicago / Central" },
      { value: "America/New_York", label: "New York / Eastern" },
      { value: "America/Toronto", label: "Toronto" },
      { value: "America/Mexico_City", label: "Mexico City" },
      { value: "America/Sao_Paulo", label: "São Paulo" },
      { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires" },
    ],
  },
  {
    group: "Europe / Africa",
    zones: [
      { value: "Europe/London", label: "London" },
      { value: "Europe/Dublin", label: "Dublin" },
      { value: "Europe/Paris", label: "Paris" },
      { value: "Europe/Berlin", label: "Berlin" },
      { value: "Europe/Madrid", label: "Madrid" },
      { value: "Europe/Rome", label: "Rome" },
      { value: "Europe/Athens", label: "Athens" },
      { value: "Europe/Istanbul", label: "Istanbul" },
      { value: "Africa/Cairo", label: "Cairo" },
      { value: "Africa/Johannesburg", label: "Johannesburg" },
    ],
  },
  {
    group: "Asia / Pacific",
    zones: [
      { value: "Asia/Dubai", label: "Dubai" },
      { value: "Asia/Kolkata", label: "India" },
      { value: "Asia/Bangkok", label: "Bangkok" },
      { value: "Asia/Singapore", label: "Singapore" },
      { value: "Asia/Shanghai", label: "Shanghai" },
      { value: "Asia/Tokyo", label: "Tokyo" },
      { value: "Asia/Seoul", label: "Seoul" },
      { value: "Australia/Sydney", label: "Sydney" },
      { value: "Pacific/Auckland", label: "Auckland" },
      { value: "Pacific/Honolulu", label: "Honolulu" },
    ],
  },
];

/** Default tz when none is set on an existing trainer row. */
export const DEFAULT_TZ: Tz = "America/New_York";

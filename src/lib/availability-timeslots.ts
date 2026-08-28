/**
 * Time slots for player availability posts.
 *
 * Two shapes live in the same `time_slots` jsonb array:
 *  - `{ date: "YYYY-MM-DD", start, end }` — a specific calendar date
 *  - `{ weekday: 0..6, start, end }` — a weekly repeating window (0 = Sunday)
 *
 * The legacy `starts_on` / `ends_on` / `recurring_days` columns are still
 * written (derived from the slots) so old readers and SQL filters keep working.
 */

export type DateSlot = { date: string; start: string; end: string };
export type WeekdaySlot = { weekday: number; start: string; end: string };
export type TimeSlot = DateSlot | WeekdaySlot;

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Order used by the legacy `recurring_days` column. */
export const LEGACY_DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const MAX_SLOTS = 40;

export const TIME_PRESETS: { id: string; label: string; start: string; end: string }[] = [
  { id: "morning", label: "Morning", start: "06:00", end: "11:00" },
  { id: "afternoon", label: "Afternoon", start: "12:00", end: "17:00" },
  { id: "evening", label: "Evening", start: "17:00", end: "22:00" },
  { id: "allday", label: "All day", start: "08:00", end: "22:00" },
];

export const isDateSlot = (s: TimeSlot): s is DateSlot =>
  typeof (s as DateSlot).date === "string";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Parse whatever came back from the database into well-formed slots. */
export function parseTimeSlots(raw: unknown): TimeSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: TimeSlot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const start = typeof o.start === "string" ? o.start : "";
    const end = typeof o.end === "string" ? o.end : "";
    if (!TIME_RE.test(start)) continue;
    if (!TIME_RE.test(end) && end !== "24:00") continue;
    if (toMin(end === "24:00" ? "23:59" : end) <= toMin(start)) continue;
    if (typeof o.date === "string" && DATE_RE.test(o.date)) {
      out.push({ date: o.date, start, end });
    } else if (typeof o.weekday === "number" && o.weekday >= 0 && o.weekday <= 6) {
      out.push({ weekday: Math.floor(o.weekday), start, end });
    }
  }
  return out;
}

/** Sort, de-dupe, merge overlapping windows on the same date/weekday, and cap. */
export function normalizeSlots(slots: TimeSlot[]): TimeSlot[] {
  const groups = new Map<string, { key: string; items: TimeSlot[] }>();
  for (const s of slots) {
    const key = isDateSlot(s) ? `d:${s.date}` : `w:${s.weekday}`;
    if (!groups.has(key)) groups.set(key, { key, items: [] });
    groups.get(key)!.items.push(s);
  }
  const out: TimeSlot[] = [];
  for (const { key, items } of [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const sorted = [...items].sort((a, b) => toMin(a.start) - toMin(b.start));
    let cur = { ...sorted[0] } as TimeSlot;
    for (let i = 1; i < sorted.length; i++) {
      const n = sorted[i];
      if (toMin(n.start) <= toMin(cur.end)) {
        if (toMin(n.end) > toMin(cur.end)) cur = { ...cur, end: n.end };
      } else {
        out.push(cur);
        cur = { ...n };
      }
    }
    out.push(cur);
    void key;
  }
  return out
    .sort((a, b) => {
      const ad = isDateSlot(a) ? a.date : `w${(a as WeekdaySlot).weekday}`;
      const bd = isDateSlot(b) ? b.date : `w${(b as WeekdaySlot).weekday}`;
      if (ad !== bd) return ad < bd ? -1 : 1;
      return toMin(a.start) - toMin(b.start);
    })
    .slice(0, MAX_SLOTS);
}

/** Legacy column values derived from the slots, so old filters keep working. */
export function deriveLegacyFields(
  slots: TimeSlot[],
  fallback: { starts_on?: string | null; ends_on?: string | null } = {},
): { starts_on: string | null; ends_on: string | null; recurring_days: string[] } {
  const dates = slots.filter(isDateSlot).map((s) => s.date).sort();
  const weekdays = Array.from(
    new Set(slots.filter((s): s is WeekdaySlot => !isDateSlot(s)).map((s) => s.weekday)),
  );
  const recurring_days = LEGACY_DAY_ORDER.filter((label) =>
    weekdays.some((w) => WEEKDAY_LABELS[w] === label),
  );
  return {
    starts_on: dates[0] ?? fallback.starts_on ?? null,
    ends_on: dates[dates.length - 1] ?? fallback.ends_on ?? null,
    recurring_days,
  };
}

export function fmt12(hhmm: string): string {
  const [hRaw, m] = hhmm.split(":").map(Number);
  const h = hRaw ?? 0;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}

export function fmtShortDate(dateKey: string): string {
  return fromDateKey(dateKey).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * True when a slot spans the whole day: either literally 00:00–24:00/23:59,
 * or matching the "All day" preset window. All-day slots never render times.
 */
export function isAllDaySlot(s: { start: string; end: string }): boolean {
  const preset = TIME_PRESETS.find((p) => p.id === "allday")!;
  if (s.start === preset.start && s.end === preset.end) return true;
  return s.start === "00:00" && (s.end === "24:00" || s.end === "23:59");
}

export function formatSlot(s: TimeSlot): string {
  const when = isDateSlot(s) ? fmtShortDate(s.date) : WEEKDAY_LABELS[s.weekday];
  if (isAllDaySlot(s)) return `${when} · All day`;
  return `${when} ${fmt12(s.start)}–${fmt12(s.end === "24:00" ? "23:59" : s.end)}`;
}

/**
 * Human summary, e.g. "3 dates · Sat 8 AM–11 AM, Sun 6 PM–9 PM".
 * Every slot is listed by default — pass `max` only to intentionally truncate.
 */
export function summarizeSlots(slots: TimeSlot[], max = Number.POSITIVE_INFINITY): string {
  if (slots.length === 0) return "";
  const dateCount = slots.filter(isDateSlot).length;
  const weekCount = slots.length - dateCount;
  const head: string[] = [];
  if (dateCount) head.push(`${dateCount} date${dateCount === 1 ? "" : "s"}`);
  if (weekCount) head.push(`${weekCount} weekly window${weekCount === 1 ? "" : "s"}`);
  const preview = slots.slice(0, max).map(formatSlot).join(", ");
  const more = slots.length > max ? ` +${slots.length - max} more` : "";
  return `${head.join(" · ")} · ${preview}${more}`;
}

/** The soonest upcoming slot occurrence, resolved against `now`. */
export function nextOccurrence(
  slots: TimeSlot[],
  now: Date = new Date(),
  horizonDays = 60,
): { dateKey: string; start: string; end: string } | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const key = toDateKey(d);
    const dayWindows = slots
      .filter((s) => (isDateSlot(s) ? s.date === key : s.weekday === d.getDay()))
      .sort((a, b) => toMin(a.start) - toMin(b.start));
    for (const w of dayWindows) {
      if (i === 0 && toMin(w.end) <= nowMin) continue;
      return { dateKey: key, start: w.start, end: w.end };
    }
  }
  return null;
}

/** Does any slot fall on a date within [fromKey, toKey] (inclusive)? */
export function slotsHitRange(slots: TimeSlot[], fromKey: string, toKey: string): boolean {
  if (slots.length === 0) return false;
  const from = fromDateKey(fromKey);
  const to = fromDateKey(toKey);
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const key = toDateKey(d);
    const day = d.getDay();
    if (slots.some((s) => (isDateSlot(s) ? s.date === key : s.weekday === day))) return true;
  }
  return false;
}

/**
 * Human window label for an availability post. Prefers the richer `time_slots`
 * and falls back to the legacy date range / weekday columns.
 */
export function formatAvailabilityWindow(a: {
  time_slots?: unknown;
  starts_on?: string | null;
  ends_on?: string | null;
  recurring_days?: string[] | null;
}): string {
  const slots = parseTimeSlots(a.time_slots ?? []);
  if (slots.length > 0) {
    const next = nextOccurrence(slots);
    const head = next
      ? isAllDaySlot(next)
        ? `Next: ${fmtShortDate(next.dateKey)} · All day`
        : `Next: ${fmtShortDate(next.dateKey)} ${fmt12(next.start)}–${fmt12(next.end)}`
      : "";
const rest = summarizeSlots(slots, slots.length);
    return [head, rest].filter(Boolean).join(" · ");
  }
  const parts: string[] = [];
  if (a.starts_on || a.ends_on) {
    const s = a.starts_on ? fmtShortDate(a.starts_on) : "";
    const e = a.ends_on ? fmtShortDate(a.ends_on) : "";
    if (s && e) parts.push(s === e ? s : `${s} – ${e}`);
    else parts.push(s || e);
  }
  if (a.recurring_days?.length) parts.push(a.recurring_days.join(" · "));
  return parts.join(" · ");
}

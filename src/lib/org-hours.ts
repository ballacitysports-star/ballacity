/**
 * Opening-hours model for gym listings (Google Business Profile style).
 *
 * Stored on `trainer_orgs.hours` as a JSON object keyed by weekday index
 * (0 = Sunday … 6 = Saturday). Times are local wall-clock "HH:MM" strings in
 * the gym's own timezone.
 */

export type DayHours = {
  /** Closed all day. */
  closed?: boolean;
  /** Open 24 hours — `ranges` is ignored. */
  open24?: boolean;
  ranges?: Array<{ open: string; close: string }>;
};

export type OrgHours = Record<string, DayHours>;

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(v: string): boolean {
  return TIME_RE.test(v);
}

export function emptyHours(): OrgHours {
  return {};
}

export function dayHours(hours: OrgHours | null | undefined, day: number): DayHours {
  return (hours ?? {})[String(day)] ?? {};
}

export function hasAnyHours(hours: OrgHours | null | undefined): boolean {
  const h = hours ?? {};
  return Object.keys(h).some((k) => {
    const d = h[k];
    return !!d && (d.open24 || d.closed || (d.ranges?.length ?? 0) > 0);
  });
}

/** Normalize arbitrary JSON into a safe {@link OrgHours} value. */
export function parseHours(raw: unknown): OrgHours {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: OrgHours = {};
  for (let d = 0; d < 7; d++) {
    const v = (raw as Record<string, unknown>)[String(d)];
    if (!v || typeof v !== "object") continue;
    const rec = v as DayHours;
    const ranges = Array.isArray(rec.ranges)
      ? rec.ranges
          .filter(
            (r) =>
              !!r &&
              typeof r.open === "string" &&
              typeof r.close === "string" &&
              isValidTime(r.open) &&
              isValidTime(r.close),
          )
          .slice(0, 3)
          .map((r) => ({ open: r.open, close: r.close }))
      : [];
    const day: DayHours = {};
    if (rec.closed) day.closed = true;
    if (rec.open24) day.open24 = true;
    if (ranges.length) day.ranges = ranges;
    if (day.closed || day.open24 || day.ranges) out[String(d)] = day;
  }
  return out;
}

/** Human label for a single day, e.g. "9:00 AM – 9:00 PM" or "Closed". */
export function formatDayHours(day: DayHours): string {
  if (day.open24) return "Open 24 hours";
  if (day.closed || !day.ranges?.length) return "Closed";
  return day.ranges.map((r) => `${formatTime(r.open)} – ${formatTime(r.close)}`).join(", ");
}

export function formatTime(hhmm: string): string {
  const m = TIME_RE.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2];
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === "00" ? `${h12} ${suffix}` : `${h12}:${min} ${suffix}`;
}

function toMinutes(hhmm: string): number {
  const m = TIME_RE.exec(hhmm);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Local weekday + minutes-since-midnight in the given IANA timezone. */
export function localNow(
  timezone?: string | null,
  now: Date = new Date(),
): { day: number; minutes: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || undefined,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const idx = (WEEKDAYS_SHORT as readonly string[]).indexOf(wd);
    return { day: idx >= 0 ? idx : now.getDay(), minutes: hour * 60 + minute };
  } catch {
    return { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
  }
}

export type OpenState = {
  status: "open" | "closed" | "unknown";
  /** True when open but closing within 60 minutes. */
  closingSoon: boolean;
  /** Minute-of-day the current interval ends (open) or next opens (closed). */
  until: string | null;
  label: string;
};

/**
 * Resolve whether the gym is open right now, handling overnight ranges that
 * spill past midnight into the next weekday.
 */
export function resolveOpenState(
  hours: OrgHours | null | undefined,
  timezone?: string | null,
  now: Date = new Date(),
): OpenState {
  const h = parseHours(hours);
  if (!hasAnyHours(h)) {
    return { status: "unknown", closingSoon: false, until: null, label: "Hours not set" };
  }
  const { day, minutes } = localNow(timezone, now);
  const today = dayHours(h, day);
  if (today.open24) {
    return { status: "open", closingSoon: false, until: null, label: "Open 24 hours" };
  }

  // Today's ranges
  for (const r of today.ranges ?? []) {
    const open = toMinutes(r.open);
    const close = toMinutes(r.close);
    if (Number.isNaN(open) || Number.isNaN(close)) continue;
    const end = close <= open ? close + 1440 : close; // overnight
    if (minutes >= open && minutes < end) {
      const closingSoon = end - minutes <= 60;
      return {
        status: "open",
        closingSoon,
        until: r.close,
        label: closingSoon
          ? `Closes at ${formatTime(r.close)}`
          : `Open · until ${formatTime(r.close)}`,
      };
    }
  }

  // Yesterday's overnight range still running
  const yesterday = dayHours(h, (day + 6) % 7);
  for (const r of yesterday.ranges ?? []) {
    const open = toMinutes(r.open);
    const close = toMinutes(r.close);
    if (Number.isNaN(open) || Number.isNaN(close)) continue;
    if (close <= open && minutes < close) {
      const closingSoon = close - minutes <= 60;
      return {
        status: "open",
        closingSoon,
        until: r.close,
        label: closingSoon
          ? `Closes at ${formatTime(r.close)}`
          : `Open · until ${formatTime(r.close)}`,
      };
    }
  }

  // Next opening within the following 7 days
  for (let i = 0; i < 7; i++) {
    const d = (day + i) % 7;
    const dh = dayHours(h, d);
    if (dh.open24 && i > 0) {
      return {
        status: "closed",
        closingSoon: false,
        until: "00:00",
        label: `Closed · opens ${i === 1 ? "tomorrow" : WEEKDAYS_SHORT[d]}`,
      };
    }
    for (const r of dh.ranges ?? []) {
      const open = toMinutes(r.open);
      if (Number.isNaN(open)) continue;
      if (i === 0 && open <= minutes) continue;
      const when =
        i === 0
          ? `at ${formatTime(r.open)}`
          : i === 1
            ? `tomorrow ${formatTime(r.open)}`
            : `${WEEKDAYS_SHORT[d]} ${formatTime(r.open)}`;
      return {
        status: "closed",
        closingSoon: false,
        until: r.open,
        label: `Closed · opens ${when}`,
      };
    }
  }

  return { status: "closed", closingSoon: false, until: null, label: "Closed" };
}

export type OpenBadge = {
  tone: "open" | "closing" | "closed" | "unknown";
  /** Short headline, e.g. "Open now" or "Closing soon". */
  headline: string;
  /** Supporting detail, e.g. "Closes at 10 PM" or "Opens tomorrow 6 AM". */
  detail: string | null;
};

/**
 * Directory-card wording for a facility's live hours, in the facility's own
 * timezone: "Open now · Closes at 10 PM", "Closing soon · Closes at 9 PM",
 * "Closed · Opens tomorrow 6 AM".
 */
export function describeOpenBadge(
  hours: OrgHours | null | undefined,
  timezone?: string | null,
  now: Date = new Date(),
): OpenBadge {
  const s = resolveOpenState(hours, timezone, now);
  if (s.status === "unknown") return { tone: "unknown", headline: "Hours not set", detail: null };
  if (s.status === "open") {
    const closes = s.until ? `Closes at ${formatTime(s.until)}` : "Open 24 hours";
    return s.closingSoon
      ? { tone: "closing", headline: "Closing soon", detail: closes }
      : { tone: "open", headline: "Open now", detail: closes };
  }
  const opens = s.label.replace(/^Closed · o/, "O");
  return { tone: "closed", headline: "Closed", detail: opens === "Closed" ? null : opens };
}

/** Detect the viewer's timezone, used as the default for new gyms. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

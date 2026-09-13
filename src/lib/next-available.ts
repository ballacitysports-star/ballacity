import type { Org } from "./sample-data";
import { resolveDay, toDateKey, type ResolvedWindow } from "./availability-resolve";
import type { TrainerBookedSlot } from "./trainer-requests";

export type NextAvailableSlot = {
  dateKey: string;
  date: Date;
  start: string; // HH:MM (viewer-local when tz-aware)
  end: string;
  venue?: string;
  source: ResolvedWindow["source"];
  ruleLabel?: string;
  trainerStart?: string;
  trainerEnd?: string;
  crossesDay?: boolean;
};

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const fromMin = (n: number) => {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/**
 * Compute the soonest bookable windows for a trainer.
 *
 * Scans forward from `now` for up to `horizonDays` days, uses `resolveDay` to
 * pull weekly + rules + overrides windows, clips windows in the past on today,
 * and subtracts any booked slots supplied via `bookedByDate`.
 */
export function computeNextAvailable(
  org: Org,
  opts: {
    now?: Date;
    viewerTz?: string | null;
    venueFilter?: string | null;
    /** Map keyed by dateKey (viewer-local) → known booked slots for that day. */
    bookedByDate?: Record<string, TrainerBookedSlot[]>;
    /** Max slots to return. */
    limit?: number;
    /** Days ahead to scan. Defaults to 30. */
    horizonDays?: number;
    /** Minimum bookable window in minutes. Defaults to 30. */
    minDurationMinutes?: number;
  } = {},
): NextAvailableSlot[] {
  const {
    now = new Date(),
    viewerTz = null,
    venueFilter = null,
    bookedByDate = {},
    limit = 3,
    horizonDays = 30,
    minDurationMinutes = 30,
  } = opts;

  const out: NextAvailableSlot[] = [];
  const trainerTz = org.timezone ?? null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nowMin = now.getHours() * 60 + now.getMinutes();

  for (let i = 0; i < horizonDays && out.length < limit; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const key = toDateKey(d);

    const windows = resolveDay(d, org.availabilitySlots ?? [], org.availabilityOverrides ?? [], {
      venueFilter,
      rules: org.availabilityRules ?? [],
      trainerTz,
      viewerTz,
    });
    if (windows.length === 0) continue;

    const booked = bookedByDate[key] ?? [];
    for (const w of windows) {
      // Clip past times on "today"
      let startMin = toMin(w.start);
      const endMin = toMin(w.end);
      if (i === 0) startMin = Math.max(startMin, nowMin);
      if (endMin - startMin < minDurationMinutes) continue;

      // Subtract booked intervals — pick earliest sub-window >= minDuration.
      const bins = booked
        .map((b) => ({ a: toMin(b.start), b: toMin(b.end) }))
        .sort((x, y) => x.a - y.a);

      let cursor = startMin;
      let picked: { s: number; e: number } | null = null;
      for (const b of bins) {
        if (b.b <= cursor) continue;
        if (b.a >= endMin) break;
        if (b.a - cursor >= minDurationMinutes) {
          picked = { s: cursor, e: b.a };
          break;
        }
        cursor = Math.max(cursor, b.b);
      }
      if (!picked && endMin - cursor >= minDurationMinutes) {
        picked = { s: cursor, e: endMin };
      }
      if (!picked) continue;

      out.push({
        dateKey: key,
        date: d,
        start: fromMin(picked.s),
        end: fromMin(picked.e),
        venue: w.venue,
        source: w.source,
        ruleLabel: w.ruleLabel,
        trainerStart: w.trainerStart,
        trainerEnd: w.trainerEnd,
        crossesDay: w.crossesDay,
      });
      if (out.length >= limit) break;
    }
  }

  return out;
}

/** Compute the dateKeys to fetch booked slots for (top of the resolved list). */
export function candidateDateKeys(
  org: Org,
  opts: {
    now?: Date;
    viewerTz?: string | null;
    venueFilter?: string | null;
    horizonDays?: number;
    maxDays?: number;
  } = {},
): string[] {
  const {
    now = new Date(),
    viewerTz = null,
    venueFilter = null,
    horizonDays = 30,
    maxDays = 7,
  } = opts;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const trainerTz = org.timezone ?? null;
  const keys: string[] = [];
  for (let i = 0; i < horizonDays && keys.length < maxDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const wins = resolveDay(d, org.availabilitySlots ?? [], org.availabilityOverrides ?? [], {
      venueFilter,
      rules: org.availabilityRules ?? [],
      trainerTz,
      viewerTz,
    });
    if (wins.length > 0) keys.push(toDateKey(d));
  }
  return keys;
}

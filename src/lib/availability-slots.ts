import type { Org } from "./sample-data";

export type Slot = NonNullable<Org["availabilitySlots"]>[number];

const TIME_RE = /^\d{2}:\d{2}$/;

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Validate a list of weekly availability slots.
 * Returns null when valid, or a { index, message } describing the first problem.
 * - Times must be HH:MM
 * - End must be strictly after start
 * - Same-day windows must not overlap
 */
export function validateSlots(
  slots: Slot[],
): { index: number; message: string } | null {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!TIME_RE.test(s.start) || !TIME_RE.test(s.end)) {
      return { index: i, message: "Enter a valid start and end time." };
    }
    const a = toMinutes(s.start);
    const b = toMinutes(s.end);
    if (b <= a) {
      return { index: i, message: "End time must be after start time." };
    }
  }
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];
      if (a.day !== b.day) continue;
      const a1 = toMinutes(a.start);
      const a2 = toMinutes(a.end);
      const b1 = toMinutes(b.start);
      const b2 = toMinutes(b.end);
      if (a1 < b2 && b1 < a2) {
        return { index: j, message: "This window overlaps another on the same day." };
      }
    }
  }
  return null;
}

import type { DayOverride, OverrideWindow } from "./availability-resolve";
import { fromDateKey, maxHorizonDate, toDateKey } from "./availability-resolve";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate the list of date overrides.
 * - date is YYYY-MM-DD and within [today, +6 months]
 * - windows are HH:MM, end > start, no overlap on the same date
 * - venue (if set) must be in the verified venues list
 */
export function validateOverrides(
  overrides: DayOverride[],
  verifiedVenues?: Set<string> | string[],
): { index: number; message: string } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = toDateKey(today);
  const horizon = toDateKey(maxHorizonDate(today));
  const verified =
    verifiedVenues instanceof Set
      ? verifiedVenues
      : new Set((verifiedVenues ?? []).map((v) => v.trim().toLowerCase()));

  const seenDates = new Set<string>();
  for (let i = 0; i < overrides.length; i++) {
    const o = overrides[i];
    if (!DATE_RE.test(o.date)) return { index: i, message: "Invalid date." };
    if (o.date < todayKey) return { index: i, message: "Date is in the past." };
    if (o.date > horizon) return { index: i, message: "Only up to 6 months out." };
    if (seenDates.has(o.date)) return { index: i, message: "Duplicate date override." };
    seenDates.add(o.date);
    if (isNaN(fromDateKey(o.date).getTime())) return { index: i, message: "Invalid date." };
    if (o.closed) continue;
    const windows = o.windows ?? [];
    for (let j = 0; j < windows.length; j++) {
      const w = windows[j];
      if (!TIME_RE.test(w.start) || !TIME_RE.test(w.end)) {
        return { index: i, message: "Enter a valid start and end time." };
      }
      if (toMinutes(w.end) <= toMinutes(w.start)) {
        return { index: i, message: "End time must be after start time." };
      }
      if (w.venue) {
        const key = w.venue.trim().toLowerCase();
        if (key && !verified.has(key)) {
          return { index: i, message: "Pick a venue from your verified list." };
        }
      }
    }
    for (let a = 0; a < windows.length; a++) {
      for (let b = a + 1; b < windows.length; b++) {
        const A = windows[a];
        const B = windows[b];
        if (toMinutes(A.start) < toMinutes(B.end) && toMinutes(B.start) < toMinutes(A.end)) {
          return { index: i, message: "This day has overlapping windows." };
        }
      }
    }
  }
  return null;
}

export type { DayOverride, OverrideWindow };


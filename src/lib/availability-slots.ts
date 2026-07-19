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

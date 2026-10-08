import { cutoffAmountLabel } from "@/lib/live-status";
import { DEFAULT_TZ, wallTimeToInstant, type Tz } from "@/lib/tz";

/**
 * Cancellation windows. Players can always cancel, but inside the host's
 * cutoff it's a late cancellation: the database records it and it counts
 * against the player's reliability like a no-show. This module is the
 * client's copy of the same rule, used to warn before the player confirms.
 */

export const DEFAULT_CANCEL_CUTOFF_MIN = 120;

export const CANCEL_CUTOFF_PRESETS: { value: number; label: string }[] = [
  { value: 0, label: "Off — cancel any time" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 360, label: "6 hours before" },
  { value: 720, label: "12 hours before" },
  { value: 1440, label: "24 hours before" },
  { value: 2880, label: "48 hours before" },
];

/** Missing or invalid values fall back to the database default. */
export function normalizeCutoff(min: number | null | undefined): number {
  const n = Number(min);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CANCEL_CUTOFF_MIN;
}

/**
 * True when cancelling now would land inside the cutoff: after the window
 * opens and before the event starts. Mirrors `record_late_cancellation`.
 */
export function isLateCancel(
  startsAt: string | Date | null | undefined,
  cutoffMin: number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!startsAt) return false;
  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return false;
  const cutoff = normalizeCutoff(cutoffMin);
  if (cutoff <= 0) return false;
  return now < start && now >= start - cutoff * 60_000;
}

/**
 * Start of a trainer session. Requests store a wall-clock date and time in
 * the trainer's time zone; without both there's no start to be late for.
 */
export function sessionStart(
  date: string | null | undefined,
  startTime: string | null | undefined,
  tz: string | null | undefined,
): Date | null {
  if (!date || !startTime) return null;
  try {
    const d = wallTimeToInstant(date, startTime.slice(0, 5), (tz || DEFAULT_TZ) as Tz);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null; // unknown time zone name
  }
}

/** "Free cancellation until 2 hours before start." */
export function cancelPolicyNote(cutoffMin: number | null | undefined): string {
  const cutoff = normalizeCutoff(cutoffMin);
  if (cutoff <= 0) return "You can cancel any time before it starts.";
  return `Free cancellation until ${cutoffAmountLabel(cutoff)} before start. Later cancellations count against your reliability.`;
}

/** Shown in a cancel confirmation when the cancellation would be late. */
export function lateCancelWarning(cutoffMin: number | null | undefined): string {
  return `It's less than ${cutoffAmountLabel(normalizeCutoff(cutoffMin))} before start, so this is a late cancellation. It's recorded and lowers your reliability score, the same as a no-show.`;
}

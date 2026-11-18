/**
 * Where an availability post stands for its author: listed, paused, run out, or closed, and when it stops being listed.
 *
 * The database decides who sees a post (migration 20261114110000, private_sec.availability_expires_at). This file mirrors
 * that rule so "My availability" can say "Listed until Sat, Nov 28" and offer "Still available" in time; it never decides
 * visibility. Keep the two in step:
 *   - any weekly slot: 14 days after last_confirmed_at;
 *   - only dated slots: when the last slot ends, in the post's timezone (America/New_York when missing or unknown);
 *   - no slots: the end of ends_on, else 14 days after last_confirmed_at.
 */
import { isDateSlot, parseTimeSlots } from "./availability-timeslots";
import { wallTimeToInstant } from "./tz";

export const RECONFIRM_DAYS = 14;
/** Start nudging the author this many days before a weekly post stops being listed. */
export const REMIND_WITHIN_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const FALLBACK_TZ = "America/New_York";

export type LifecyclePost = {
  status: string;
  time_slots?: unknown;
  timezone?: string | null;
  ends_on?: string | null;
  last_confirmed_at?: string | null;
  created_at?: string | null;
};

export type ListingState = "listed" | "paused" | "ended" | "closed" | "guardian_closed";

export type Listing = {
  state: ListingState;
  /** When the post stops (or stopped) being listed; null when unknown. */
  expiresAt: Date | null;
  /** Weekly or open-ended posts can be kept listed with "Still available"; dated posts need new dates. */
  recurring: boolean;
  /** Show "Still available" (listed but about to run out, or run out). */
  canReconfirm: boolean;
  /** Worth flagging to the author now. */
  needsAttention: boolean;
  /** Short line for the author. */
  label: string;
};

export function safeTimezone(tz: string | null | undefined): string {
  if (!tz || !tz.trim()) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return FALLBACK_TZ;
  }
}

function addDaysKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Mirrors private_sec.availability_expires_at. */
export function availabilityExpiresAt(post: LifecyclePost): Date | null {
  const slots = parseTimeSlots(post.time_slots ?? []);
  const tz = safeTimezone(post.timezone);
  const confirmedRaw = post.last_confirmed_at ?? post.created_at ?? null;
  const confirmed = confirmedRaw ? new Date(confirmedRaw) : null;
  const afterConfirm =
    confirmed && !Number.isNaN(confirmed.getTime())
      ? new Date(confirmed.getTime() + RECONFIRM_DAYS * DAY_MS)
      : null;

  if (slots.length > 0) {
    if (slots.some((s) => !isDateSlot(s))) return afterConfirm;
    let last: Date | null = null;
    for (const s of slots) {
      if (!isDateSlot(s)) continue;
      const end = wallTimeToInstant(s.date, s.end, tz);
      if (!Number.isNaN(end.getTime()) && (!last || end > last)) last = end;
    }
    return last ?? afterConfirm;
  }
  if (post.ends_on && /^\d{4}-\d{2}-\d{2}$/.test(post.ends_on)) {
    return wallTimeToInstant(addDaysKey(post.ends_on, 1), "00:00", tz);
  }
  return afterConfirm;
}

function isRecurring(post: LifecyclePost): boolean {
  const slots = parseTimeSlots(post.time_slots ?? []);
  if (slots.length === 0) return !post.ends_on;
  return slots.some((s) => !isDateSlot(s));
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function listingFor(post: LifecyclePost, now: Date = new Date()): Listing {
  const expiresAt = availabilityExpiresAt(post);
  const recurring = isRecurring(post);
  const base = { expiresAt, recurring, canReconfirm: false, needsAttention: false };

  switch (post.status) {
    case "paused":
      return { ...base, state: "paused", label: "Paused: only you can see it" };
    case "closed":
      return { ...base, state: "closed", label: "Closed by BallaCity" };
    case "inactive":
      return { ...base, state: "guardian_closed", label: "Closed by a parent or guardian" };
  }

  const ranOut = post.status === "expired" || (expiresAt !== null && expiresAt <= now);
  if (ranOut) {
    return {
      ...base,
      state: "ended",
      canReconfirm: recurring,
      needsAttention: true,
      label: recurring
        ? "Not listed: confirm you're still available"
        : "Not listed: your dates have passed",
    };
  }

  const soon =
    expiresAt !== null && expiresAt.getTime() - now.getTime() <= REMIND_WITHIN_DAYS * DAY_MS;
  return {
    ...base,
    state: "listed",
    canReconfirm: recurring && soon,
    needsAttention: recurring && soon,
    label: expiresAt ? `Listed until ${shortDate(expiresAt)}` : "Listed",
  };
}

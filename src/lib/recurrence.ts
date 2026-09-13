/**
 * Repeat rules for anything schedulable in the app.
 *
 * A rule expands to a list of date keys ("YYYY-MM-DD"). Times live on the
 * schedule entries, not the rule, so a weekly event can still give one day a
 * different start time. Exceptions record skipped dates.
 */

import { addDaysToKey, isDateKey, weekdayOfKey, WEEKDAY_LABELS } from "@/lib/datetime";

export type RecurrenceFreq = "none" | "daily" | "weekly" | "biweekly" | "monthly";

export type RecurrenceRule = {
  freq: RecurrenceFreq;
  /** Weekdays (0=Sun) for weekly/biweekly. Empty = the start day's weekday. */
  weekdays?: number[];
  /** Stop after this many occurrences. */
  count?: number | null;
  /** Stop on this date key (inclusive). */
  until?: string | null;
  /** Date keys explicitly skipped by the host. */
  exceptions?: string[];
};

/** Never generate more sessions than this from one rule. */
export const MAX_OCCURRENCES = 60;
export const DEFAULT_COUNT = 8;

export const NO_REPEAT: RecurrenceRule = { freq: "none" };

export const FREQ_OPTIONS: { value: RecurrenceFreq; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Every month" },
];

export function isRepeating(rule: RecurrenceRule | null | undefined): boolean {
  return !!rule && rule.freq !== "none";
}

/** Normalize a rule: dedupe weekdays, clamp count, drop bad dates. */
export function normalizeRule(rule: RecurrenceRule): RecurrenceRule {
  const weekdays = [...new Set((rule.weekdays ?? []).filter((d) => d >= 0 && d <= 6))].sort(
    (a, b) => a - b,
  );
  const count =
    rule.count == null ? null : Math.min(MAX_OCCURRENCES, Math.max(1, Math.round(rule.count)));
  return {
    freq: rule.freq,
    weekdays,
    count,
    until: rule.until && isDateKey(rule.until) ? rule.until : null,
    exceptions: [...new Set((rule.exceptions ?? []).filter(isDateKey))].sort(),
  };
}

/** Nth weekday-of-month for a date key, e.g. "3rd Tuesday" -> 3. */
function weekOfMonth(key: string): number {
  const day = Number(key.slice(8, 10));
  return Math.floor((day - 1) / 7) + 1;
}

function monthlyNext(key: string, nth: number, weekday: number): string | null {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const first = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  const firstWeekday = weekdayOfKey(first);
  const offset = ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7;
  const candidate = addDaysToKey(first, offset);
  // Rolled into the following month (e.g. no 5th Tuesday) — skip it.
  return candidate.slice(0, 7) === first.slice(0, 7) ? candidate : null;
}

/**
 * Expand a rule into date keys starting at `startKey` (always included unless
 * it is an exception). Bounded by count, until, and MAX_OCCURRENCES.
 */
export function expandRecurrence(startKey: string, rule: RecurrenceRule): string[] {
  if (!isDateKey(startKey)) return [];
  const r = normalizeRule(rule);
  const skip = new Set(r.exceptions ?? []);

  if (r.freq === "none") return skip.has(startKey) ? [] : [startKey];

  // Pattern slots first (count/until bound the *pattern*), then skipped dates
  // are removed — skipping a date does not pull an extra one in from later.
  const limit = r.count ?? (r.until ? MAX_OCCURRENCES : DEFAULT_COUNT);
  const slots: string[] = [];
  const push = (k: string) => {
    if (r.until && k > r.until) return false;
    slots.push(k);
    return true;
  };

  if (r.freq === "daily") {
    let k = startKey;
    for (let i = 0; i < MAX_OCCURRENCES * 2 && slots.length < limit; i++) {
      if (!push(k)) break;
      k = addDaysToKey(k, 1);
    }
  } else if (r.freq === "weekly" || r.freq === "biweekly") {
    const stride = r.freq === "weekly" ? 7 : 14;
    const days = r.weekdays?.length ? r.weekdays : [weekdayOfKey(startKey)];
    // Anchor on the Sunday of the start week, then walk week blocks.
    let weekStart = addDaysToKey(startKey, -weekdayOfKey(startKey));
    for (let w = 0; w < MAX_OCCURRENCES && slots.length < limit; w++) {
      let stop = false;
      for (const d of days) {
        const k = addDaysToKey(weekStart, d);
        if (k < startKey) continue;
        if (slots.length >= limit) break;
        if (!push(k)) {
          stop = true;
          break;
        }
      }
      if (stop) break;
      weekStart = addDaysToKey(weekStart, stride);
    }
  } else if (r.freq === "monthly") {
    const nth = weekOfMonth(startKey);
    const weekday = weekdayOfKey(startKey);
    let k: string | null = startKey;
    for (let i = 0; i < MAX_OCCURRENCES && slots.length < limit && k; i++) {
      if (!push(k)) break;
      k = monthlyNext(k, nth, weekday);
    }
  }

  return slots
    .filter((k) => !skip.has(k))
    .slice(0, MAX_OCCURRENCES)
    .sort();
}

/** Toggle a date as skipped/kept in the rule's exception list. */
export function toggleException(rule: RecurrenceRule, key: string): RecurrenceRule {
  const set = new Set(rule.exceptions ?? []);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return normalizeRule({ ...rule, exceptions: [...set] });
}

/** Plain-English summary of a rule, e.g. "Every week on Mon, Wed · 8 times". */
export function describeRule(rule: RecurrenceRule, startKey?: string): string {
  const r = normalizeRule(rule);
  if (r.freq === "none") return "Does not repeat";
  const base = FREQ_OPTIONS.find((f) => f.value === r.freq)?.label ?? "Repeats";
  const parts = [base];
  if (r.freq === "weekly" || r.freq === "biweekly") {
    const days = r.weekdays?.length
      ? r.weekdays
      : startKey && isDateKey(startKey)
        ? [weekdayOfKey(startKey)]
        : [];
    if (days.length) parts.push(`on ${days.map((d) => WEEKDAY_LABELS[d]).join(", ")}`);
  }
  const tail: string[] = [];
  if (r.count) tail.push(`${r.count} times`);
  if (r.until) tail.push(`until ${r.until}`);
  if (r.exceptions?.length) tail.push(`${r.exceptions.length} skipped`);
  return tail.length ? `${parts.join(" ")} · ${tail.join(" · ")}` : parts.join(" ");
}

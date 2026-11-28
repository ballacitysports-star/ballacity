/**
 * When Restore on a post report may unhide the post (owner decision 2026-11-28): only to undo this report's own Remove
 * content, never a hide that anyone else made after it. Pure, so the queue's server functions and the queue card share
 * one rule and the client bundle can import it.
 */

/** The summary Remove content writes on a post report; Restore reads it back to know that this report hid the post. */
export const POST_HIDDEN_SUMMARY = "Post hidden";

/** Why Restore leaves a hidden post hidden, in the words the summary and the queue card both use. */
export const RESTORE_KEEPS_HIDDEN = {
  otherReport: "another report about this post was acted on",
  notThisReport: "this report did not hide it",
  hiddenSince: "it was hidden again, or this report was updated, after this report hid it",
} as const;

const TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * A timestamptz as PostgREST returns it ("2026-11-28T10:00:00.123+00:00") or toISOString writes it
 * ("2026-11-28T10:00:00.123Z"), in whole microseconds since the epoch, so two spellings of one instant compare equal
 * and two instants a microsecond apart do not. null for anything else.
 */
export function timestampMicros(ts: string | null | undefined): number | null {
  const m = TIMESTAMP.exec(ts ?? "");
  if (!m) return null;
  const [, date, time, fraction = "", zone] = m;
  const offset =
    zone.toUpperCase() === "Z"
      ? "Z"
      : `${zone.slice(0, 3)}:${zone.length > 3 ? zone.slice(-2) : "00"}`;
  const ms = Date.parse(`${date}T${time}${offset}`);
  return Number.isNaN(ms) ? null : ms * 1000 + Number(fraction.padEnd(6, "0"));
}

/**
 * Why Restore on a post report must leave its hidden post hidden, or null when it may unhide it. It may only when all
 * three hold:
 * - this report's own Remove content hid the post: its notes start with POST_HIDDEN_SUMMARY;
 * - the post's hidden_at is exactly this report's reviewed_at. Remove content writes both from one timestamp, so a later
 *   hide (a superadmin, another moderator) moves hidden_at away from it. Anything that changes this report's
 *   reviewed_at after its Remove content (a status change, a second action, a direct update) also keeps the post
 *   hidden: the rule fails safe;
 * - no other report about the post has been resolved or actioned.
 * For a hidden post only (hiddenAt set): a post that is not hidden has nothing to unhide.
 */
export function postRestoreBlocker(input: {
  resolutionNotes: string | null;
  reviewedAt: string | null;
  hiddenAt: string | null;
  otherClosedReports: number;
}): string | null {
  if (input.otherClosedReports > 0) return RESTORE_KEEPS_HIDDEN.otherReport;
  if (!(input.resolutionNotes ?? "").startsWith(POST_HIDDEN_SUMMARY)) {
    return RESTORE_KEEPS_HIDDEN.notThisReport;
  }
  const hidden = timestampMicros(input.hiddenAt);
  if (hidden === null || hidden !== timestampMicros(input.reviewedAt)) {
    return RESTORE_KEEPS_HIDDEN.hiddenSince;
  }
  return null;
}

/** What the queue card says before Restore runs: while the post is hidden, why Restore would leave it so; else null. */
export function restoreKeepsHidden(input: Parameters<typeof postRestoreBlocker>[0]): string | null {
  return input.hiddenAt ? postRestoreBlocker(input) : null;
}

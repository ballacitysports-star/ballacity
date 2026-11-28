/**
 * What Restore on a post report may undo (owner decision 2026-11-28): only this report's own action, never a hide,
 * suspension or ban that anyone else made after it. Pure, so the queue's server functions and the queue card share one
 * rule and the client bundle can import it.
 */

/** The summary Remove content writes on a post report; Restore reads it back to know that this report hid the post. */
export const POST_HIDDEN_SUMMARY = "Post hidden";

/** The summaries Suspend and Ban write; Restore reads them back to know that this report suspended or banned. */
export const ACCOUNT_SUSPENDED_SUMMARY = "Account suspended";
export const ACCOUNT_BANNED_SUMMARY = "Account banned";
export const ACCOUNT_ACTION_SUMMARIES = [
  ACCOUNT_SUSPENDED_SUMMARY,
  ACCOUNT_BANNED_SUMMARY,
] as const;

/**
 * Why Restore leaves a hidden post hidden, in the words the summary and the queue card both use. Each is true whenever
 * it is given: notThisReport reads only the report's notes, which its latest action (or status change with notes)
 * wrote, so it says no more than that.
 */
export const RESTORE_KEEPS_HIDDEN = {
  otherReport: "another report about this post was acted on",
  notThisReport: "this report's latest action did not hide it",
  hiddenSince: "it was hidden again, or this report was updated, after this report hid it",
} as const;

/** Why Restore on a post report leaves the author's suspension or ban in place. */
export const RESTORE_KEEPS_ACCOUNT = {
  otherReport: "another report about this account suspended or banned it",
  notThisReport: "this report's latest action did not suspend or ban it",
  changedSince:
    "the suspension was changed, or this report was updated, after this report's action",
} as const;

/** Restore could not read what it needs, so it changed nothing; the moderator can try again. */
export const RESTORE_READ_FAILED =
  "Couldn't read what this report changed, so Restore changed nothing. Please try again.";

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

/** Whether a report's notes say it suspended or banned its account: what counts as another report's ban in force. */
export function notesClaimAccountAction(notes: string | null): boolean {
  return ACCOUNT_ACTION_SUMMARIES.some((summary) => (notes ?? "").startsWith(summary));
}

/**
 * Why Restore on a post report must leave the author's suspension or ban in place, or null when it may lift it. The
 * same three conditions as for the post: this report's own Suspend or Ban made it (its notes say so), suspended_at is
 * still exactly this report's reviewed_at (both written from one `now`; a later suspension, a superadmin's lift or any
 * later change to this report moves one of them), and no other resolved or actioned report about the author says it
 * suspended or banned them. For a restricted account only.
 */
export function accountRestoreBlocker(input: {
  resolutionNotes: string | null;
  reviewedAt: string | null;
  suspendedAt: string | null;
  otherAccountReports: number;
}): string | null {
  if (input.otherAccountReports > 0) return RESTORE_KEEPS_ACCOUNT.otherReport;
  if (!notesClaimAccountAction(input.resolutionNotes)) return RESTORE_KEEPS_ACCOUNT.notThisReport;
  const at = timestampMicros(input.suspendedAt);
  if (at === null || at !== timestampMicros(input.reviewedAt)) {
    return RESTORE_KEEPS_ACCOUNT.changedSince;
  }
  return null;
}

/** An account in these states is restricted, as the database's own gates read it (with suspended_at set). */
export function accountRestricted(suspendedAt: string | null, moderationState: string): boolean {
  return suspendedAt !== null || moderationState === "suspended" || moderationState === "banned";
}

/** The author's account Restore keeps, and where a superadmin lifts it (/superadmin, Users & profiles). */
export function keptAccountSentence(moderationState: string, why: string): string {
  const state = moderationState === "banned" ? "banned" : "suspended";
  return `The account stays ${state}: ${why}. A superadmin lifts the suspension on /superadmin, Users & profiles, Restore account.`;
}

/** The post Restore keeps hidden, and where a superadmin unhides it (/superadmin, Content, Network posts). */
export function keptPostSentence(why: string): string {
  return `The post stays hidden: ${why}. A superadmin unhides it on /superadmin, Content, Network posts.`;
}

/**
 * Restore's summary on a post report (the toast, the report's notes, the audit entry): what it undid ("ban lifted",
 * "post unhidden"), then each thing it kept. It never starts with an action's summary, so a later Restore of the same
 * report undoes nothing more.
 */
export function restoreSummary(undone: string[], kept: string[]): string {
  const head = undone.length
    ? `${undone.join(", ")}.`
    : kept.length
      ? "nothing undone."
      : "nothing to undo.";
  return [head.charAt(0).toUpperCase() + head.slice(1), ...kept].join(" ");
}

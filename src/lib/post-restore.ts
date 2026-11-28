/**
 * What Restore on a post report may undo (owner decision 2026-11-28): only this report's own action, never a hide,
 * suspension, ban or warning that anyone else made. Pure, so the queue's server functions and the queue card share one
 * rule and the client bundle can import it.
 *
 * A report owns a change when it made it: its own action wrote the post's hidden_at or the author's suspended_at, and
 * the row still holds exactly that value. Every action on a post report records the value it wrote in its audit entry
 * (after.hiddenAt, after.suspendedAt), so a later action, status change or Restore on the same report never makes it
 * lose its earlier action. A report acted on before that was recorded owns a change by its notes and reviewed_at, as
 * before. Remove content, Suspend and Ban never overwrite a hide or suspension that is already there, so a report never
 * takes over a change someone else made.
 *
 * Suspend and Ban also record the moderation_state they wrote (after.moderationState), whether they found the account
 * unrestricted (after.fresh), and when they ran (after.actedAt). A superadmin's lift clears suspended_at and leaves
 * moderation_state, which the database's gates still read; Restore resets that state only when this report's own
 * action wrote it and nothing else may have written it since (stateOwnership).
 */

/** The summary Remove content writes on a post report when it hid the post. */
export const POST_HIDDEN_SUMMARY = "Post hidden";
/** The summary Remove content writes when the post was already hidden: it changed nothing, so it owns nothing. */
export const POST_ALREADY_HIDDEN_SUMMARY = "Post already hidden";

/** The summaries Suspend and Ban write when they suspended or banned an account nobody had restricted. */
export const ACCOUNT_SUSPENDED_SUMMARY = "Account suspended";
export const ACCOUNT_BANNED_SUMMARY = "Account banned";
export const ACCOUNT_ACTION_SUMMARIES = [
  ACCOUNT_SUSPENDED_SUMMARY,
  ACCOUNT_BANNED_SUMMARY,
] as const;
/**
 * Added to the Suspend or Ban summary when the account was already suspended or banned: the action kept that suspension
 * (and raised a suspension to a ban), so this report does not own it. The summary still starts with the action's, so the
 * report still counts as another report that suspended or banned the account.
 */
export const ALREADY_RESTRICTED_NOTE = " (it was already restricted)";

/** The summary Warn writes. */
export const WARNING_ISSUED_SUMMARY = "Warning issued";

/** The audit actions of the moderation actions Restore reads back (moderation.functions.ts MODERATION_AUDIT_ACTION). */
export const REPORT_ACTION_AUDITS = [
  "content.remove",
  "user.suspend",
  "user.ban",
  "user.warn",
] as const;

/** Report statuses that mean a moderator acted on the report (report-status.ts: the Resolved queue). */
export const ACTED_ON_STATUSES = ["resolved", "actioned"] as const;

/** A profile in these states is restricted, as the database's own gates read it (with suspended_at set or not). */
export const RESTRICTED_STATES: readonly string[] = ["suspended", "banned"];

/** The audit actions that may write moderation_state to suspended or banned. */
const RESTRICTING_AUDITS: readonly string[] = ["user.suspend", "user.ban"];

/**
 * Why Restore leaves a hidden post hidden, in the words the summary and the queue card both use. Each is true whenever
 * it is given. notThisReport says "latest action": a report acted on before its actions were recorded in the audit log
 * is judged by its notes, which only its latest action (or status change with notes) wrote.
 */
export const RESTORE_KEEPS_HIDDEN = {
  otherReport: "another report about this post was acted on",
  notThisReport: "this report's latest action did not hide it",
  alreadyHidden: "it was already hidden when this report's Remove content ran",
  hiddenSince: "it was hidden again, or this report was updated, after this report hid it",
} as const;

/** Why Restore on a post report leaves the author's suspension or ban in place. */
export const RESTORE_KEEPS_ACCOUNT = {
  otherReport: "another report about this account that is not dismissed suspended or banned it",
  notThisReport: "this report's latest action did not suspend or ban it",
  alreadyRestricted: "it was already suspended or banned when this report's action ran",
  changedSince:
    "the suspension was changed, or this report was updated, after this report's action",
} as const;

/**
 * Why Restore on a post report leaves the author's moderation_state 'suspended' or 'banned' once suspended_at is cleared
 * (a superadmin's lift, or this Restore's lift of a suspended_at this report filled in on an account already banned).
 */
export const RESTORE_KEEPS_STATE = {
  notThisReport: "this report's latest action did not suspend or ban it",
  unknown: "Restore cannot tell that this report's own Suspend or Ban set it",
  already: "it was already suspended or banned when this report's action ran",
  changedSince: "another action may have set it after this report's own Suspend or Ban",
} as const;

/** Why Restore on a post report leaves the author's warning in place. */
export const RESTORE_KEEPS_WARNING = {
  otherReport: "another report about this account that is not dismissed issued a warning",
  notThisReport: "this report's latest action did not issue it",
} as const;

/** Restore could not read what it needs, so it changed nothing; the moderator can try again. */
export const RESTORE_READ_FAILED =
  "Couldn't read what this report changed, so Restore changed nothing. Please try again.";

/** A write of Restore's failed: the report keeps its status and notes, so Restore can run again. */
export const RESTORE_LEFT_REPORT =
  "A change failed, so this report was left as it was and Restore can run again.";

/** Restore's update of the report matched nothing: the report changed while Restore ran (another moderator acted). */
export const RESTORE_REPORT_CHANGED =
  "This report changed while Restore ran, so its status and notes were left as they are.";

/** Restore's update of the report failed: what it undid stays undone, and the report keeps its status and notes. */
export const RESTORE_REPORT_UPDATE_FAILED =
  "Couldn't update this report, so its status and notes were left as they are.";

/** A Restore that undid nothing leaves the report as it is, so it keeps counting, and can undo its own action later. */
export const RESTORE_LEFT_AS_IS = "Restore left this report as it is.";

/** How a refused Restore starts: this report's own action is in force, but another report stands behind it. */
export const RESTORE_REFUSED_PREFIX = "Restore changed nothing and left this report as it is.";

/** Whether the queue shows an error from Restore as it is: its own sentences, never a database's. */
export function restoreMessageShownAsIs(text: string): boolean {
  return text === RESTORE_READ_FAILED || text.startsWith(RESTORE_REFUSED_PREFIX);
}

/** The queue card could not read what Restore would keep. */
export const RESTORE_CHECK_FAILED =
  "Couldn't check what Restore would leave in place. Restore checks again, and changes nothing it cannot account for.";

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

/** One moderation action a report took, as its audit entry records it. */
export type ReportAction = {
  reportId: string | null;
  action: string;
  /** The hidden_at this action's Remove content wrote; null when it wrote none (or before this was recorded). */
  hiddenAt: string | null;
  /** The suspended_at this action's Suspend or Ban wrote (on an unrestricted account, or filled in); null otherwise. */
  suspendedAt: string | null;
  /** The moderation_state this action's Suspend or Ban wrote; null when it wrote none (or before this was recorded). */
  moderationState?: string | null;
  /** Its Suspend or Ban found the account unrestricted (suspended_at empty, 'active' or 'warned'). */
  fresh?: boolean;
  /**
   * When its Suspend or Ban ran (its `now`, before it wrote); null before this was recorded. An entry with it records
   * every profile write it made, so one without moderationState wrote none.
   */
  actedAt?: string | null;
  createdAt: string | null;
};

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** An admin_audit_log row (action, before, after, created_at) as a ReportAction. */
export function reportActionFromAudit(row: {
  action?: unknown;
  before?: unknown;
  after?: unknown;
  created_at?: unknown;
}): ReportAction {
  const before = (row.before ?? {}) as Record<string, unknown>;
  const after = (row.after ?? {}) as Record<string, unknown>;
  return {
    reportId: text(before.reportId),
    action: text(row.action) ?? "",
    hiddenAt: text(after.hiddenAt),
    suspendedAt: text(after.suspendedAt),
    moderationState: text(after.moderationState),
    fresh: after.fresh === true,
    actedAt: text(after.actedAt),
    createdAt: text(row.created_at),
  };
}

/** Another report as Restore and the card read it: any status but dismissed. */
export type OtherReport = {
  id: string;
  status: string | null;
  resolution_notes: string | null;
  reviewed_at?: string | null;
};

const startsWithAny = (notes: string | null, prefixes: readonly string[]) =>
  prefixes.some((p) => (notes ?? "").startsWith(p));

const actionsBy = (actions: readonly ReportAction[], reportId: string, names: readonly string[]) =>
  actions.filter((a) => a.reportId === reportId && names.includes(a.action));

/**
 * The other reports about a post that keep its hide in place: every one resolved or actioned (owner decision a), and
 * every one not dismissed that hid it or chose to (Remove content, by its notes or its audit entries).
 */
export function otherPostReports(
  rows: readonly OtherReport[],
  actions: readonly ReportAction[],
  selfId: string,
): number {
  return rows.filter(
    (r) =>
      r.id !== selfId &&
      r.status !== "dismissed" &&
      ((ACTED_ON_STATUSES as readonly string[]).includes(r.status ?? "") ||
        startsWithAny(r.resolution_notes, [POST_HIDDEN_SUMMARY, POST_ALREADY_HIDDEN_SUMMARY]) ||
        actionsBy(actions, r.id, ["content.remove"]).length > 0),
  ).length;
}

/**
 * The other reports about the author, not dismissed, that suspended or banned the account or chose to (by their notes or
 * their audit entries). With `since` (the suspended_at this report's own Suspend or Ban wrote on an account nobody had
 * restricted), a report whose last change was before it is left out: whatever it did had been lifted by then.
 */
export function otherAccountReports(
  rows: readonly OtherReport[],
  actions: readonly ReportAction[],
  selfId: string,
  since: string | null,
): number {
  const from = timestampMicros(since);
  return rows.filter((r) => {
    if (r.id === selfId || r.status === "dismissed") return false;
    const own = actionsBy(actions, r.id, ["user.suspend", "user.ban"]);
    if (!startsWithAny(r.resolution_notes, ACCOUNT_ACTION_SUMMARIES) && !own.length) return false;
    if (from === null) return true;
    // Its last change: its reviewed_at, or a later audit entry. Unknown counts (fail closed).
    const times = [r.reviewed_at ?? null, ...own.map((a) => a.createdAt)].map(timestampMicros);
    return times.some((t) => t === null || t >= from);
  }).length;
}

/** The other reports about the author, not dismissed, that warned them (by their notes or their audit entries). */
export function otherWarningReports(
  rows: readonly OtherReport[],
  actions: readonly ReportAction[],
  selfId: string,
): number {
  return rows.filter(
    (r) =>
      r.id !== selfId &&
      r.status !== "dismissed" &&
      (startsWithAny(r.resolution_notes, [WARNING_ISSUED_SUMMARY]) ||
        actionsBy(actions, r.id, ["user.warn"]).length > 0),
  ).length;
}

/** The hidden_at values this report's own Remove content wrote, from its audit entries. */
export function ownHides(actions: readonly ReportAction[], reportId: string): string[] {
  return actionsBy(actions, reportId, ["content.remove"]).flatMap((a) =>
    a.hiddenAt ? [a.hiddenAt] : [],
  );
}

/** How many times this report's own Warn ran, from its audit entries. */
export function ownWarnings(actions: readonly ReportAction[], reportId: string): number {
  return actionsBy(actions, reportId, ["user.warn"]).length;
}

/** The suspended_at values this report's own Suspend or Ban wrote, from its audit entries. */
export function ownSuspensions(actions: readonly ReportAction[], reportId: string): string[] {
  return actionsBy(actions, reportId, ["user.suspend", "user.ban"]).flatMap((a) =>
    a.suspendedAt ? [a.suspendedAt] : [],
  );
}

/** When an action ran: its actedAt (before it wrote), else its audit entry's created_at. */
const ranAt = (a: ReportAction) => a.actedAt ?? a.createdAt;

/**
 * This report's own latest Suspend or Ban that recorded the moderation_state it wrote, or null when none did (or when
 * one of them has no time, so the latest cannot be told).
 */
export function ownStateWrite(
  actions: readonly ReportAction[],
  reportId: string,
): ReportAction | null {
  const writes = actionsBy(actions, reportId, RESTRICTING_AUDITS).filter((a) => a.moderationState);
  const times = writes.map((a) => timestampMicros(ranAt(a)));
  if (!writes.length || times.some((t) => t === null)) return null;
  const at = times as number[];
  return writes[at.indexOf(Math.max(...at))];
}

/**
 * Whether an action other than `write` may have written moderation_state at or after `at`: a Suspend or Ban (of any
 * report, this one included) whose audit entry recorded a state it wrote, or one that does not say (recorded before
 * this was, or on another kind of report, whose Suspend and Ban write it unguarded). An entry that records its writes
 * and wrote no state did not write it. Restore and Warn never write suspended or banned, and nothing else writes
 * moderation_state. Entries are compared by created_at, which comes after their write; one with no time counts.
 */
export function stateWrittenSince(
  actions: readonly ReportAction[],
  write: ReportAction,
  at: string | null,
): boolean {
  const from = timestampMicros(at);
  return actions.some((a) => {
    if (a === write || !RESTRICTING_AUDITS.includes(a.action)) return false;
    if (a.actedAt && !a.moderationState) return false;
    const t = timestampMicros(a.createdAt);
    return from === null || t === null || t >= from;
  });
}

/**
 * This report's own Suspend or Ban that set the author's moderation_state as it is now ('suspended' or 'banned'), or
 * null: its latest one that recorded a state wrote exactly this state, and no other action may have written it since
 * (stateWrittenSince). With suspended_at cleared (a superadmin's lift leaves moderation_state as it was), this is what
 * lets Restore reset the state this report's own action left, and nothing else.
 */
export function stateOwnership(
  actions: readonly ReportAction[],
  reportId: string,
  moderationState: string,
): ReportAction | null {
  if (!RESTRICTED_STATES.includes(moderationState)) return null;
  const write = ownStateWrite(actions, reportId);
  if (!write || write.moderationState !== moderationState) return null;
  return stateWrittenSince(actions, write, ranAt(write)) ? null : write;
}

/** Why Restore leaves the author's moderation_state suspended or banned once suspended_at is clear (RESTORE_KEEPS_STATE). */
export function stateKeptReason(input: {
  resolutionNotes: string | null;
  actions: readonly ReportAction[];
  reportId: string;
}): string {
  const own = actionsBy(input.actions, input.reportId, RESTRICTING_AUDITS);
  if (own.some((a) => a.moderationState)) return RESTORE_KEEPS_STATE.changedSince;
  if (own.some((a) => a.actedAt)) return RESTORE_KEEPS_STATE.already;
  if (own.length || notesClaimAccountAction(input.resolutionNotes)) {
    return RESTORE_KEEPS_STATE.unknown;
  }
  return RESTORE_KEEPS_STATE.notThisReport;
}

/**
 * Why Restore on a post report must leave its hidden post hidden, or null when it may unhide it. It may only when:
 * - this report owns the hide: an audit entry of its own Remove content recorded exactly the post's hidden_at, or (for a
 *   report acted on before that was recorded) its notes start with POST_HIDDEN_SUMMARY and hidden_at is exactly its
 *   reviewed_at (Remove content writes both from one `now`; anything that changes either later keeps the hide: the rule
 *   fails safe);
 * - and no other report keeps it (otherPostReports).
 * Ownership is judged first: otherReport is given only for a hide this report owns, which Restore can undo once that
 * other report is dismissed. For a hidden post only (hiddenAt set): a post that is not hidden has nothing to unhide.
 */
export function postRestoreBlocker(input: {
  resolutionNotes: string | null;
  reviewedAt: string | null;
  hiddenAt: string | null;
  ownHides: readonly string[];
  otherReports: number;
}): string | null {
  const hidden = timestampMicros(input.hiddenAt);
  const notes = input.resolutionNotes ?? "";
  const byAudit = hidden !== null && input.ownHides.some((h) => timestampMicros(h) === hidden);
  const byNotes =
    notes.startsWith(POST_HIDDEN_SUMMARY) &&
    hidden !== null &&
    hidden === timestampMicros(input.reviewedAt);
  if (!byAudit && !byNotes) {
    if (notes.startsWith(POST_ALREADY_HIDDEN_SUMMARY)) return RESTORE_KEEPS_HIDDEN.alreadyHidden;
    if (notes.startsWith(POST_HIDDEN_SUMMARY) || input.ownHides.length) {
      return RESTORE_KEEPS_HIDDEN.hiddenSince;
    }
    return RESTORE_KEEPS_HIDDEN.notThisReport;
  }
  if (input.otherReports > 0) return RESTORE_KEEPS_HIDDEN.otherReport;
  return null;
}

/** What the queue card says before Restore runs: while the post is hidden, why Restore would leave it so; else null. */
export function restoreKeepsHidden(input: Parameters<typeof postRestoreBlocker>[0]): string | null {
  return input.hiddenAt ? postRestoreBlocker(input) : null;
}

/** Whether a report's notes say it suspended or banned its account (with or without ALREADY_RESTRICTED_NOTE). */
export function notesClaimAccountAction(notes: string | null): boolean {
  return startsWithAny(notes, ACCOUNT_ACTION_SUMMARIES);
}

/** Whether a report's notes say its own Suspend or Ban made the suspension: the summary alone, or "<summary> — …". */
function notesOwnAccountAction(notes: string): boolean {
  return ACCOUNT_ACTION_SUMMARIES.some((s) => notes === s || notes.startsWith(`${s} — `));
}

/**
 * How this report owns the author's suspension: "audit" when an audit entry of its own Suspend or Ban recorded exactly
 * the suspended_at (written on an account nobody had restricted), "notes" when (for a report acted on before that was
 * recorded) its notes say its Suspend or Ban made it and suspended_at is exactly its reviewed_at, else null.
 */
export function suspensionOwnership(input: {
  resolutionNotes: string | null;
  reviewedAt: string | null;
  suspendedAt: string | null;
  ownSuspensions: readonly string[];
}): "audit" | "notes" | null {
  const at = timestampMicros(input.suspendedAt);
  if (at === null) return null;
  if (input.ownSuspensions.some((s) => timestampMicros(s) === at)) return "audit";
  if (
    notesOwnAccountAction(input.resolutionNotes ?? "") &&
    at === timestampMicros(input.reviewedAt)
  ) {
    return "notes";
  }
  return null;
}

/**
 * Why Restore on a post report must leave the author's suspension or ban in place, or null when it may lift it: this
 * report owns the suspension (suspensionOwnership) and no other report keeps it (otherAccountReports). Ownership is
 * judged first, as for the post. For an account with suspended_at set only.
 */
export function accountRestoreBlocker(input: {
  resolutionNotes: string | null;
  reviewedAt: string | null;
  suspendedAt: string | null;
  ownSuspensions: readonly string[];
  otherReports: number;
}): string | null {
  if (!suspensionOwnership(input)) {
    const notes = input.resolutionNotes ?? "";
    if (ACCOUNT_ACTION_SUMMARIES.some((s) => notes.startsWith(`${s}${ALREADY_RESTRICTED_NOTE}`))) {
      return RESTORE_KEEPS_ACCOUNT.alreadyRestricted;
    }
    if (notesClaimAccountAction(notes) || input.ownSuspensions.length) {
      return RESTORE_KEEPS_ACCOUNT.changedSince;
    }
    return RESTORE_KEEPS_ACCOUNT.notThisReport;
  }
  if (input.otherReports > 0) return RESTORE_KEEPS_ACCOUNT.otherReport;
  return null;
}

/** What Restore on a post report does with the author's account (accountRestorePlan). */
export type AccountRestore = {
  /** Clear suspended_at and suspended_reason: this report's own Suspend or Ban wrote them. */
  clearSuspension: boolean;
  /** Reset moderation_state (to 'active', or 'warned' while another report's warning stands): this report's action set it. */
  resetState: boolean;
  /** What stays, as the summary says it, when Restore lifts nothing; null when it lifts something or there is nothing. */
  kept: string | null;
  /** What stays once the lift succeeded: a moderation_state this report did not set; null when none. */
  keptAfter: string | null;
  /** Restore is refused: this report owns the suspension or state, but another report keeps it (the reason). */
  refused: string | null;
};

/**
 * What Restore on a post report may do with the author's account, before any write:
 * - suspended_at that is not this report's own (suspensionOwnership) stays, and so does the moderation_state with it;
 * - suspended_at this report owns is cleared; moderation_state is reset only when this report's own action set it
 *   (stateOwnership; for a report acted on before that was recorded, its notes, as before);
 * - with suspended_at clear, a 'suspended' or 'banned' state is reset only when this report's own action set it;
 * - and only while no other report keeps it (otherAccountReports): otherwise Restore is refused. Another report whose
 *   last change came before this report's action is left out only when every action this report owns by found the
 *   account unrestricted: whatever that report did had been lifted by then.
 */
export function accountRestorePlan(input: {
  reportId: string;
  resolutionNotes: string | null;
  reviewedAt: string | null;
  suspendedAt: string | null;
  moderationState: string;
  actions: readonly ReportAction[];
  reports: readonly OtherReport[];
}): AccountRestore {
  const { actions, reportId, suspendedAt, moderationState: state } = input;
  const none: AccountRestore = {
    clearSuspension: false,
    resetState: false,
    kept: null,
    keptAfter: null,
    refused: null,
  };
  const restricted = RESTRICTED_STATES.includes(state);
  const base = {
    resolutionNotes: input.resolutionNotes,
    reviewedAt: input.reviewedAt,
    suspendedAt,
    ownSuspensions: ownSuspensions(actions, reportId),
  };
  const suspension = suspensionOwnership(base);
  if (suspendedAt !== null && !suspension) {
    const why =
      accountRestoreBlocker({ ...base, otherReports: 0 }) ?? RESTORE_KEEPS_ACCOUNT.notThisReport;
    return { ...none, kept: keptAccountSentence(state, why) };
  }
  const stateWrite = suspension === "notes" ? null : stateOwnership(actions, reportId, state);
  const resetState = suspension === "notes" || stateWrite !== null;
  const stateStays = () => keptStateSentence(state, stateKeptReason({ ...input }));
  if (suspendedAt === null && !resetState)
    return restricted ? { ...none, kept: stateStays() } : none;

  // The actions this report owns by: the one that wrote suspended_at, the one that set moderation_state.
  const at = timestampMicros(suspendedAt);
  const owning = [
    ...(suspension === "audit"
      ? actionsBy(actions, reportId, RESTRICTING_AUDITS).filter(
          (a) => at !== null && timestampMicros(a.suspendedAt) === at,
        )
      : []),
    ...(stateWrite ? [stateWrite] : []),
  ];
  const times = owning.map((a) => timestampMicros(ranAt(a)));
  // None for an older report, owned by its notes: every other report counts, however old.
  const since =
    owning.length > 0 && owning.every((a) => a.fresh) && times.every((t) => t !== null)
      ? ranAt(owning[times.indexOf(Math.min(...(times as number[])))])
      : null;
  if (otherAccountReports(input.reports, actions, reportId, since) > 0) {
    return { ...none, refused: RESTORE_KEEPS_ACCOUNT.otherReport };
  }
  return {
    ...none,
    clearSuspension: suspendedAt !== null,
    resetState,
    keptAfter: !resetState && restricted ? stateStays() : null,
  };
}

/**
 * Why Restore must leave the author's warning ('warned') in place, or null when it may clear it: this report warned them
 * (its notes, or an audit entry of its own Warn) and no other report did (otherWarningReports). A warning has no
 * timestamp, so this is as close as Restore can tell.
 */
export function warningRestoreBlocker(input: {
  resolutionNotes: string | null;
  ownWarnings: number;
  otherReports: number;
}): string | null {
  if (!(input.resolutionNotes ?? "").startsWith(WARNING_ISSUED_SUMMARY) && !input.ownWarnings) {
    return RESTORE_KEEPS_WARNING.notThisReport;
  }
  if (input.otherReports > 0) return RESTORE_KEEPS_WARNING.otherReport;
  return null;
}

/**
 * The author's account Restore keeps (suspended_at set), and where a superadmin lifts it (/superadmin, Users & profiles).
 */
export function keptAccountSentence(moderationState: string, why: string): string {
  const state = moderationState === "banned" ? "banned" : "suspended";
  return `The account stays ${state}: ${why}. A superadmin lifts the suspension on /superadmin, Users & profiles, Restore account.`;
}

/**
 * The account Restore keeps when its suspended_at is cleared but moderation_state still says suspended or banned (a
 * superadmin's lift leaves moderation_state as it was), and why (RESTORE_KEEPS_STATE): no screen resets what is left,
 * so the sentence names none.
 */
export function keptStateSentence(moderationState: string, why: string): string {
  const state = moderationState === "banned" ? "banned" : "suspended";
  return `The account stays ${state}: its suspension is lifted, but its moderation state is still ${state}, and ${why}.`;
}

/** The post Restore keeps hidden, and where a superadmin unhides it (/superadmin, Content, Network posts). */
export function keptPostSentence(why: string): string {
  return `The post stays hidden: ${why}. A superadmin unhides it on /superadmin, Content, Network posts.`;
}

/** The warning Restore keeps. */
export function keptWarningSentence(why: string): string {
  return `The warning stays: ${why}.`;
}

/**
 * Restore refused: this report's own hide or suspension is in force, but another report stands behind it. Nothing is
 * changed and the report stays as it is, so Restore can undo its action once that report is dismissed.
 */
export function restoreRefusal(reasons: string[]): string {
  return [
    RESTORE_REFUSED_PREFIX,
    ...reasons,
    "Dismiss that report first if its action no longer applies, then Restore this one again.",
  ].join(" ");
}

/** The queue card's sentence for a hidden post Restore would leave hidden (`why` from restoreKeepsHidden). */
export function restoreCardNote(why: string): string {
  if (why === RESTORE_CHECK_FAILED) return why;
  if (why === RESTORE_KEEPS_HIDDEN.otherReport) {
    return `Restore changes nothing while ${why}: this report's own hide stays, and so does the report. Dismiss that report first if its action no longer applies.`;
  }
  return `Restore leaves the post hidden: ${why}. A superadmin unhides it on /superadmin, Content, Network posts.`;
}

/**
 * Restore's summary on a post report (the toast, the report's notes, the audit entry): what it undid ("ban lifted",
 * "post unhidden"), then each thing it kept. It never starts with an action's summary.
 */
export function restoreSummary(undone: string[], kept: string[]): string {
  const head = undone.length
    ? `${undone.join(", ")}.`
    : kept.length
      ? "nothing undone."
      : "nothing to undo.";
  return [head.charAt(0).toUpperCase() + head.slice(1), ...kept].join(" ");
}

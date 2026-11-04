/**
 * Location-disclosure holds (SEC-1, review round 4 F2-2).
 *
 * When two established accounts report that a youth-inclusive game reveals a private location, the database HOLDS the listing text: it is removed
 * from public view and kept as moderator-only evidence. Only a moderator decision releases the hold: "Restore text"
 * (`moderator_restore_game_text`) or "Confirm removal" (`moderator_confirm_location_hold`). The database refuses to resolve or dismiss such a
 * report any other way (LOCATION_HOLD_OPEN), so the generic close actions are disabled while a hold is open.
 */
export type LocationHoldDecision = "restore" | "confirm";

/** Report statuses that close a report. */
const CLOSING = new Set(["resolved", "dismissed", "actioned", "closed"]);

export function closesReport(status: string): boolean {
  return CLOSING.has(status);
}

/** Whether this report is about a game whose text is currently held. */
export function hasOpenLocationHold(report: {
  reason: string;
  gameId: string | null;
  locationHold?: boolean;
}): boolean {
  return report.reason === "location_disclosed" && !!report.gameId && !!report.locationHold;
}

/** Generic moderation actions that would close the report (or act on the game) and so must wait for the hold decision. */
export function blockedByLocationHold(
  report: { reason: string; gameId: string | null; locationHold?: boolean },
  action: { status?: string; action?: string },
): boolean {
  if (!hasOpenLocationHold(report)) return false;
  if (action.status) return closesReport(action.status);
  // warn/suspend/ban/remove_content/restore all close the report as resolved or dismissed
  return !!action.action;
}

export const LOCATION_HOLD_MESSAGE =
  "This listing's text is held. Restore the text or confirm the removal first; that closes the reports.";

/** The RPC that records each decision. */
export function locationHoldRpc(decision: LocationHoldDecision) {
  return decision === "restore" ? "moderator_restore_game_text" : "moderator_confirm_location_hold";
}

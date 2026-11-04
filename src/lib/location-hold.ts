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

/**
 * The original listing text an open hold keeps as evidence (`location_report_evidence`), shown to the moderator so Restore text or
 * Confirm removal is decided with the text in view (SEC-7). Moderators only: the table's row security admits moderators and
 * administrators, and the server reads it with the moderator's own session after checking the role. It is never part of anything a
 * host or a reporter receives.
 */
export type HeldEvidence = {
  capturedAt: string;
  title: string | null;
  description: string | null;
  neighborhood: string | null;
  gameRules: string | null;
  equipment: string[];
  cancellationNotes: string | null;
  cancellationReason: string | null;
};

export type EvidenceRow = {
  game_id: string | null;
  captured_at: string;
  captured_by: string | null;
  released_at: string | null;
  title: string | null;
  description: string | null;
  neighborhood: string | null;
  game_rules: string | null;
  equipment: string[] | null;
  cancellation_notes: string | null;
  cancellation_reason: string | null;
};

/** The columns the report detail needs; nothing else is read. */
export const EVIDENCE_COLUMNS =
  "game_id, captured_at, captured_by, released_at, title, description, neighborhood, game_rules, equipment, cancellation_notes, cancellation_reason";

/** The latest OPEN automatic hold per game (released_at and captured_by empty), the one Restore text would bring back. */
export function latestOpenEvidenceByGame(rows: EvidenceRow[]): Map<string, HeldEvidence> {
  const out = new Map<string, HeldEvidence & { _t: number }>();
  for (const r of rows) {
    if (!r.game_id || r.released_at || r.captured_by) continue;
    const t = Date.parse(r.captured_at);
    const prev = out.get(r.game_id);
    if (prev && prev._t >= t) continue;
    out.set(r.game_id, {
      _t: t,
      capturedAt: r.captured_at,
      title: r.title,
      description: r.description,
      neighborhood: r.neighborhood,
      gameRules: r.game_rules,
      equipment: r.equipment ?? [],
      cancellationNotes: r.cancellation_notes,
      cancellationReason: r.cancellation_reason,
    });
  }
  return new Map(Array.from(out, ([k, { _t, ...v }]) => [k, v]));
}

/** The non-empty evidence fields, labelled, in the order the moderator reads them. */
export function evidenceFields(e: HeldEvidence): { label: string; value: string }[] {
  const fields: [string, string | null][] = [
    ["Title", e.title],
    ["Description", e.description],
    ["Neighborhood", e.neighborhood],
    ["Game rules", e.gameRules],
    ["Equipment", e.equipment.length ? e.equipment.join(", ") : null],
    ["Cancellation notes", e.cancellationNotes],
    ["Cancellation reason", e.cancellationReason],
  ];
  return fields
    .filter((f): f is [string, string] => !!f[1] && f[1].trim() !== "")
    .map(([label, value]) => ({ label, value }));
}

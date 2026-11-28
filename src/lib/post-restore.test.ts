import { describe, expect, it } from "vitest";

/**
 * The Restore rule for post reports (owner decision 2026-11-28), pure: which change a report owns (its audit entries
 * record what its own actions wrote; a report acted on before that by its notes and reviewed_at), which other reports
 * keep it, and the words the summary, a refusal and the queue card use. moderation.functions.post-reports.test.ts runs
 * the same rule through the server functions.
 */

import {
  RESTORE_CHECK_FAILED,
  RESTORE_KEEPS_ACCOUNT,
  RESTORE_KEEPS_HIDDEN,
  RESTORE_KEEPS_WARNING,
  RESTORE_READ_FAILED,
  RESTORE_REFUSED_PREFIX,
  accountRestoreBlocker,
  keptAccountSentence,
  keptPostSentence,
  keptStateSentence,
  keptWarningSentence,
  otherAccountReports,
  otherPostReports,
  otherWarningReports,
  ownHides,
  ownSuspensions,
  ownWarnings,
  postRestoreBlocker,
  reportActionFromAudit,
  restoreCardNote,
  restoreKeepsHidden,
  restoreMessageShownAsIs,
  restoreRefusal,
  restoreSummary,
  suspensionOwnership,
  timestampMicros,
  warningRestoreBlocker,
  type ReportAction,
} from "@/lib/post-restore";

/** An earlier moment: a superadmin's hide or suspension, or another report's action, before this report's. */
const T_EARLIER = "2026-11-27T09:00:00.789+00:00";
/** This report's action: the value it wrote and its reviewed_at as PostgREST returns them, from one `now`. */
const T_MINE = "2026-11-27T11:00:00.123+00:00";
/** A later moment: a superadmin's or another moderator's hide, or a later change to this report. */
const T_LATER = "2026-11-27T12:30:00.456+00:00";

const MINE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

/** An admin_audit_log row of a report's action, as Restore and the card read it back. */
const auditRow = (reportId: string, action: string, after: Record<string, unknown> = {}) => ({
  action,
  before: { reportId, reportReason: "harassment" },
  after: { summary: "x", reportedUserId: "author", ...after },
  created_at: T_MINE,
});

describe("the Restore rule (post-restore.ts)", () => {
  const act = (
    reportId: string,
    action: string,
    over: Partial<ReportAction> = {},
  ): ReportAction => ({
    reportId,
    action,
    hiddenAt: null,
    suspendedAt: null,
    createdAt: T_MINE,
    ...over,
  });

  describe("the post", () => {
    const own = {
      resolutionNotes: "Post hidden — abuse",
      reviewedAt: T_MINE,
      hiddenAt: T_MINE,
      ownHides: [] as string[],
      otherReports: 0,
    };

    it("lets Restore unhide this report's own hide (by its notes and reviewed_at), while no other report keeps it", () => {
      expect(postRestoreBlocker(own)).toBeNull();
      expect(postRestoreBlocker({ ...own, resolutionNotes: "Post hidden" })).toBeNull();
      expect(postRestoreBlocker({ ...own, otherReports: 1 })).toBe(
        RESTORE_KEEPS_HIDDEN.otherReport,
      );
      expect(postRestoreBlocker({ ...own, resolutionNotes: "Warning issued" })).toBe(
        RESTORE_KEEPS_HIDDEN.notThisReport,
      );
      expect(postRestoreBlocker({ ...own, resolutionNotes: null })).toBe(
        RESTORE_KEEPS_HIDDEN.notThisReport,
      );
    });

    it("judges ownership first: another report is the reason only for a hide this report owns", () => {
      // a weak report that hid nothing: the reason is that, not the other report (Restore dismisses it)
      expect(postRestoreBlocker({ ...own, resolutionNotes: null, otherReports: 2 })).toBe(
        RESTORE_KEEPS_HIDDEN.notThisReport,
      );
      expect(postRestoreBlocker({ ...own, hiddenAt: T_LATER, otherReports: 1 })).toBe(
        RESTORE_KEEPS_HIDDEN.hiddenSince,
      );
    });

    it("knows this report's own hide from its audit entry, after any later change to the report", () => {
      const later = { ...own, resolutionNotes: "Warning issued — x", reviewedAt: T_LATER };
      expect(postRestoreBlocker({ ...later, ownHides: ["2026-11-27T11:00:00.123Z"] })).toBeNull();
      expect(postRestoreBlocker({ ...later, ownHides: [T_EARLIER, T_MINE], otherReports: 1 })).toBe(
        RESTORE_KEEPS_HIDDEN.otherReport,
      );
      // its audit entry says it hid the post at another moment: hidden again since
      expect(postRestoreBlocker({ ...later, ownHides: [T_EARLIER] })).toBe(
        RESTORE_KEEPS_HIDDEN.hiddenSince,
      );
      expect(postRestoreBlocker({ ...later, ownHides: ["2026-11-27T11:00:00.123001+00:00"] })).toBe(
        RESTORE_KEEPS_HIDDEN.hiddenSince,
      );
    });

    it("never owns a hide that was there before this report's Remove content", () => {
      expect(postRestoreBlocker({ ...own, resolutionNotes: "Post already hidden — abuse" })).toBe(
        RESTORE_KEEPS_HIDDEN.alreadyHidden,
      );
    });

    it("keeps a post hidden whose hidden_at is not exactly this report's reviewed_at", () => {
      expect(postRestoreBlocker({ ...own, hiddenAt: T_LATER })).toBe(
        RESTORE_KEEPS_HIDDEN.hiddenSince,
      );
      expect(postRestoreBlocker({ ...own, reviewedAt: T_LATER })).toBe(
        RESTORE_KEEPS_HIDDEN.hiddenSince,
      );
      expect(postRestoreBlocker({ ...own, hiddenAt: "2026-11-27T11:00:00.123001+00:00" })).toBe(
        RESTORE_KEEPS_HIDDEN.hiddenSince,
      );
      expect(postRestoreBlocker({ ...own, reviewedAt: null })).toBe(
        RESTORE_KEEPS_HIDDEN.hiddenSince,
      );
      expect(postRestoreBlocker({ ...own, hiddenAt: "not a time", reviewedAt: "not a time" })).toBe(
        RESTORE_KEEPS_HIDDEN.hiddenSince,
      );
      expect(postRestoreBlocker({ ...own, reviewedAt: "2026-11-27T11:00:00.123Z" })).toBeNull();
    });

    it("says nothing before Restore about a post that is not hidden", () => {
      expect(restoreKeepsHidden({ ...own, hiddenAt: null, resolutionNotes: null })).toBeNull();
      expect(restoreKeepsHidden({ ...own, hiddenAt: T_LATER })).toBe(
        RESTORE_KEEPS_HIDDEN.hiddenSince,
      );
    });

    it("counts the other reports that keep a hide: acted on, or not dismissed and chose Remove content", () => {
      const row = (id: string, status: string, notes: string | null = null) => ({
        id,
        status,
        resolution_notes: notes,
      });
      expect(otherPostReports([row(OTHER_ID, "resolved", "duplicate")], [], MINE_ID)).toBe(1);
      expect(otherPostReports([row(OTHER_ID, "actioned")], [], MINE_ID)).toBe(1);
      expect(otherPostReports([row(OTHER_ID, "escalated", "Post hidden — x")], [], MINE_ID)).toBe(
        1,
      );
      expect(otherPostReports([row(OTHER_ID, "open", "Post already hidden")], [], MINE_ID)).toBe(1);
      expect(
        otherPostReports(
          [row(OTHER_ID, "investigating")],
          [act(OTHER_ID, "content.remove")],
          MINE_ID,
        ),
      ).toBe(1);
      // never this report, a dismissed one, or an open one that chose nothing
      expect(otherPostReports([row(MINE_ID, "resolved", "Post hidden")], [], MINE_ID)).toBe(0);
      expect(
        otherPostReports(
          [row(OTHER_ID, "dismissed", "Post hidden")],
          [act(OTHER_ID, "content.remove")],
          MINE_ID,
        ),
      ).toBe(0);
      expect(
        otherPostReports(
          [row(OTHER_ID, "new"), row(OTHER_ID, "escalated", "Warning issued")],
          [act(OTHER_ID, "user.warn"), act(MINE_ID, "content.remove")],
          MINE_ID,
        ),
      ).toBe(0);
    });

    it("reads a report's own hides from its audit entries", () => {
      const actions = [
        act(MINE_ID, "content.remove", { hiddenAt: T_MINE }),
        act(MINE_ID, "content.remove"),
        act(MINE_ID, "user.ban", { hiddenAt: T_LATER }),
        act(OTHER_ID, "content.remove", { hiddenAt: T_LATER }),
      ];
      expect(ownHides(actions, MINE_ID)).toEqual([T_MINE]);
    });
  });

  describe("the account", () => {
    const ownBan = {
      resolutionNotes: "Account banned — abuse",
      reviewedAt: T_MINE,
      suspendedAt: T_MINE,
      ownSuspensions: [] as string[],
      otherReports: 0,
    };

    it("lifts this report's own, unchanged ban or suspension (by its notes and reviewed_at)", () => {
      expect(accountRestoreBlocker(ownBan)).toBeNull();
      expect(suspensionOwnership(ownBan)).toBe("notes");
      expect(accountRestoreBlocker({ ...ownBan, resolutionNotes: "Account suspended" })).toBeNull();
      expect(
        accountRestoreBlocker({ ...ownBan, suspendedAt: "2026-11-27T11:00:00.123Z" }),
      ).toBeNull();
      expect(accountRestoreBlocker({ ...ownBan, otherReports: 1 })).toBe(
        RESTORE_KEEPS_ACCOUNT.otherReport,
      );
      // only the summary alone or "<summary> — …" says this report's own Suspend or Ban made it
      expect(suspensionOwnership({ ...ownBan, resolutionNotes: "Account bannedx" })).toBeNull();
      for (const notes of [null, "Post hidden — abuse", "Warning issued", "Ban lifted."]) {
        expect(accountRestoreBlocker({ ...ownBan, resolutionNotes: notes })).toBe(
          RESTORE_KEEPS_ACCOUNT.notThisReport,
        );
      }
      expect(accountRestoreBlocker({ ...ownBan, suspendedAt: T_LATER })).toBe(
        RESTORE_KEEPS_ACCOUNT.changedSince,
      );
      expect(accountRestoreBlocker({ ...ownBan, reviewedAt: T_LATER })).toBe(
        RESTORE_KEEPS_ACCOUNT.changedSince,
      );
      expect(accountRestoreBlocker({ ...ownBan, suspendedAt: null })).toBe(
        RESTORE_KEEPS_ACCOUNT.changedSince,
      );
    });

    it("judges ownership first: another report is the reason only for a suspension this report owns", () => {
      expect(accountRestoreBlocker({ ...ownBan, resolutionNotes: null, otherReports: 2 })).toBe(
        RESTORE_KEEPS_ACCOUNT.notThisReport,
      );
      expect(accountRestoreBlocker({ ...ownBan, suspendedAt: T_LATER, otherReports: 1 })).toBe(
        RESTORE_KEEPS_ACCOUNT.changedSince,
      );
    });

    it("never owns a suspension that was there before this report's Suspend or Ban, even at its timestamp", () => {
      for (const notes of [
        "Account banned (it was already restricted) — abuse",
        "Account suspended (it was already restricted)",
      ]) {
        expect(suspensionOwnership({ ...ownBan, resolutionNotes: notes })).toBeNull();
        expect(accountRestoreBlocker({ ...ownBan, resolutionNotes: notes })).toBe(
          RESTORE_KEEPS_ACCOUNT.alreadyRestricted,
        );
      }
    });

    it("knows this report's own suspension from its audit entry, after any later change to the report", () => {
      const later = { ...ownBan, resolutionNotes: "Post hidden", reviewedAt: T_LATER };
      expect(suspensionOwnership({ ...later, ownSuspensions: ["2026-11-27T11:00:00.123Z"] })).toBe(
        "audit",
      );
      expect(accountRestoreBlocker({ ...later, ownSuspensions: [T_MINE] })).toBeNull();
      expect(accountRestoreBlocker({ ...later, ownSuspensions: [T_EARLIER] })).toBe(
        RESTORE_KEEPS_ACCOUNT.changedSince,
      );
      expect(
        suspensionOwnership({ ...later, ownSuspensions: [T_MINE], suspendedAt: null }),
      ).toBeNull();
    });

    it("counts the other reports, not dismissed, that suspended or banned the author or chose to", () => {
      const row = (
        id: string,
        status: string,
        notes: string | null,
        reviewed_at: string | null = T_LATER,
      ) => ({
        id,
        status,
        resolution_notes: notes,
        reviewed_at,
      });
      expect(
        otherAccountReports(
          [row(OTHER_ID, "resolved", "Account suspended — spam")],
          [],
          MINE_ID,
          null,
        ),
      ).toBe(1);
      expect(
        otherAccountReports(
          [row(OTHER_ID, "escalated", "Account banned (it was already restricted)")],
          [],
          MINE_ID,
          null,
        ),
      ).toBe(1);
      expect(
        otherAccountReports(
          [row(OTHER_ID, "open", "Warning issued")],
          [act(OTHER_ID, "user.ban")],
          MINE_ID,
          null,
        ),
      ).toBe(1);
      expect(
        otherAccountReports(
          [row(OTHER_ID, "resolved", "Accountability note")],
          [act(OTHER_ID, "user.warn")],
          MINE_ID,
          null,
        ),
      ).toBe(0);
      expect(
        otherAccountReports(
          [row(OTHER_ID, "dismissed", "Account banned")],
          [act(OTHER_ID, "user.ban")],
          MINE_ID,
          null,
        ),
      ).toBe(0);
      expect(
        otherAccountReports([row(MINE_ID, "resolved", "Account banned")], [], MINE_ID, null),
      ).toBe(0);
    });

    it("leaves out another report whose last change was before this report's own new suspension", () => {
      const row = (reviewed_at: string | null) => ({
        id: OTHER_ID,
        status: "resolved",
        resolution_notes: "Account banned — old",
        reviewed_at,
      });
      expect(otherAccountReports([row(T_EARLIER)], [], MINE_ID, T_MINE)).toBe(0);
      // without `since` (owned by notes only) it counts, however old
      expect(otherAccountReports([row(T_EARLIER)], [], MINE_ID, null)).toBe(1);
      expect(otherAccountReports([row(T_LATER)], [], MINE_ID, T_MINE)).toBe(1);
      expect(otherAccountReports([row(T_MINE)], [], MINE_ID, T_MINE)).toBe(1);
      expect(otherAccountReports([row(null)], [], MINE_ID, T_MINE)).toBe(1);
      expect(otherAccountReports([row("not a time")], [], MINE_ID, T_MINE)).toBe(1);
      // a later audit entry of its own Suspend or Ban counts, whatever its reviewed_at
      expect(
        otherAccountReports(
          [row(T_EARLIER)],
          [act(OTHER_ID, "user.ban", { createdAt: T_LATER })],
          MINE_ID,
          T_MINE,
        ),
      ).toBe(1);
      expect(
        otherAccountReports(
          [row(T_EARLIER)],
          [act(OTHER_ID, "user.warn", { createdAt: T_LATER })],
          MINE_ID,
          T_MINE,
        ),
      ).toBe(0);
    });

    it("reads a report's own suspensions from its audit entries", () => {
      const actions = [
        act(MINE_ID, "user.ban", { suspendedAt: T_MINE }),
        act(MINE_ID, "user.suspend", { suspendedAt: T_LATER }),
        act(MINE_ID, "user.suspend"),
        act(MINE_ID, "content.remove", { suspendedAt: T_EARLIER }),
        act(OTHER_ID, "user.ban", { suspendedAt: T_EARLIER }),
      ];
      expect(ownSuspensions(actions, MINE_ID)).toEqual([T_MINE, T_LATER]);
    });
  });

  describe("the warning", () => {
    it("clears a warning only this report issued", () => {
      expect(
        warningRestoreBlocker({
          resolutionNotes: "Warning issued — x",
          ownWarnings: 0,
          otherReports: 0,
        }),
      ).toBeNull();
      expect(
        warningRestoreBlocker({ resolutionNotes: "Post hidden", ownWarnings: 1, otherReports: 0 }),
      ).toBeNull();
      expect(
        warningRestoreBlocker({ resolutionNotes: "Post hidden", ownWarnings: 0, otherReports: 0 }),
      ).toBe(RESTORE_KEEPS_WARNING.notThisReport);
      expect(
        warningRestoreBlocker({
          resolutionNotes: "Warning issued",
          ownWarnings: 1,
          otherReports: 1,
        }),
      ).toBe(RESTORE_KEEPS_WARNING.otherReport);
    });

    it("counts the other reports, not dismissed, that warned the author", () => {
      const row = (id: string, status: string, notes: string | null) => ({
        id,
        status,
        resolution_notes: notes,
      });
      expect(
        otherWarningReports([row(OTHER_ID, "resolved", "Warning issued — x")], [], MINE_ID),
      ).toBe(1);
      expect(
        otherWarningReports(
          [row(OTHER_ID, "escalated", "Post hidden")],
          [act(OTHER_ID, "user.warn")],
          MINE_ID,
        ),
      ).toBe(1);
      expect(
        otherWarningReports(
          [row(OTHER_ID, "dismissed", "Warning issued")],
          [act(OTHER_ID, "user.warn")],
          MINE_ID,
        ),
      ).toBe(0);
      expect(otherWarningReports([row(MINE_ID, "resolved", "Warning issued")], [], MINE_ID)).toBe(
        0,
      );
      expect(
        otherWarningReports(
          [row(OTHER_ID, "resolved", "Account banned")],
          [act(OTHER_ID, "user.ban")],
          MINE_ID,
        ),
      ).toBe(0);
      expect(
        ownWarnings(
          [act(MINE_ID, "user.warn"), act(MINE_ID, "user.ban"), act(OTHER_ID, "user.warn")],
          MINE_ID,
        ),
      ).toBe(1);
    });
  });

  it("reads an audit row as a report's action", () => {
    expect(
      reportActionFromAudit(auditRow(MINE_ID, "content.remove", { hiddenAt: T_MINE })),
    ).toEqual({
      reportId: MINE_ID,
      action: "content.remove",
      hiddenAt: T_MINE,
      suspendedAt: null,
      createdAt: T_MINE,
    });
    // a superadmin's entry names no report
    expect(
      reportActionFromAudit({
        action: "user.suspend",
        before: { suspended_at: null },
        after: null,
      }),
    ).toEqual({
      reportId: null,
      action: "user.suspend",
      hiddenAt: null,
      suspendedAt: null,
      createdAt: null,
    });
    expect(
      reportActionFromAudit({ action: 3, before: { reportId: 7 }, after: { suspendedAt: 1 } }),
    ).toMatchObject({
      reportId: null,
      action: "",
      suspendedAt: null,
    });
  });

  it("says notThisReport only in words that are true for a report acted on before its actions were recorded", () => {
    expect(RESTORE_KEEPS_HIDDEN.notThisReport).toBe("this report's latest action did not hide it");
    expect(RESTORE_KEEPS_ACCOUNT.notThisReport).toBe(
      "this report's latest action did not suspend or ban it",
    );
  });

  it("writes summaries, refusals and card notes that say what was undone and kept, and never claim an action", () => {
    expect(restoreSummary(["ban lifted", "post unhidden"], [])).toBe("Ban lifted, post unhidden.");
    expect(restoreSummary([], [])).toBe("Nothing to undo.");
    const kept = keptPostSentence(RESTORE_KEEPS_HIDDEN.hiddenSince);
    expect(kept).toBe(
      "The post stays hidden: it was hidden again, or this report was updated, after this report hid it. A superadmin unhides it on /superadmin, Content, Network posts.",
    );
    expect(restoreSummary([], [kept])).toBe(`Nothing undone. ${kept}`);
    expect(keptAccountSentence("suspended", "x")).toBe(
      "The account stays suspended: x. A superadmin lifts the suspension on /superadmin, Users & profiles, Restore account.",
    );
    expect(keptAccountSentence("warned", "x")).toMatch(/^The account stays suspended: x\./);
    expect(keptAccountSentence("banned", "x")).toMatch(/^The account stays banned: x\./);
    // suspended_at already cleared: no screen is named, since none lifts what is left
    expect(keptStateSentence("banned")).toBe(
      "The account stays banned: its suspension was lifted already, but its moderation state is still banned, and Restore on a post report does not change that.",
    );
    expect(keptStateSentence("suspended")).not.toMatch(/superadmin|Restore account/);
    expect(keptWarningSentence("x")).toBe("The warning stays: x.");
    expect(restoreRefusal(["The post stays hidden: y."])).toBe(
      `${RESTORE_REFUSED_PREFIX} The post stays hidden: y. Dismiss that report first if its action no longer applies, then Restore this one again.`,
    );
    expect(restoreCardNote(RESTORE_KEEPS_HIDDEN.otherReport)).toBe(
      "Restore changes nothing while another report about this post was acted on: this report's own hide stays, and so does the report. Dismiss that report first if its action no longer applies.",
    );
    expect(restoreCardNote(RESTORE_KEEPS_HIDDEN.notThisReport)).toBe(
      "Restore dismisses this report but leaves the post hidden: this report's latest action did not hide it. A superadmin unhides it on /superadmin, Content, Network posts.",
    );
    expect(restoreCardNote(RESTORE_CHECK_FAILED)).toBe(RESTORE_CHECK_FAILED);
    for (const s of [
      restoreSummary(["post unhidden"], []),
      restoreSummary(["warning cleared"], [kept]),
      restoreSummary([], [kept]),
      restoreRefusal([kept]),
    ]) {
      expect(s).not.toMatch(
        /^(Post hidden|Post already hidden|Account suspended|Account banned|Warning issued)/,
      );
    }
  });

  it("reads a timestamptz to the microsecond, whatever its spelling", () => {
    const at = Date.parse("2026-11-27T11:00:00Z") * 1000;
    expect(timestampMicros("2026-11-27T11:00:00Z")).toBe(at);
    expect(timestampMicros("2026-11-27T11:00:00.123Z")).toBe(at + 123000);
    expect(timestampMicros("2026-11-27T11:00:00.123+00:00")).toBe(at + 123000);
    expect(timestampMicros("2026-11-27 11:00:00.123+00")).toBe(at + 123000);
    expect(timestampMicros("2026-11-27T11:00:00.123456+00:00")).toBe(at + 123456);
    expect(timestampMicros("2026-11-27T12:30:00.123+01:30")).toBe(at + 123000);
    expect(timestampMicros("2026-11-27T11:00:00")).toBeNull();
    expect(timestampMicros("yesterday")).toBeNull();
    expect(timestampMicros(null)).toBeNull();
  });

  it("lets the queue show Restore's own error sentences as they are, and nothing else", () => {
    expect(restoreMessageShownAsIs(RESTORE_READ_FAILED)).toBe(true);
    expect(restoreMessageShownAsIs(restoreRefusal(["The post stays hidden: x."]))).toBe(true);
    expect(restoreMessageShownAsIs('duplicate key value violates unique constraint "x"')).toBe(
      false,
    );
    expect(restoreMessageShownAsIs(`${RESTORE_READ_FAILED} extra`)).toBe(false);
  });
});

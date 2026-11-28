import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Restore on a post report and the author's account, past what moderation.functions.post-reports.test.ts covers (review
 * findings on #487, 2026-11-28): a superadmin's Restore account clears suspended_at and leaves moderation_state
 * 'banned', which the database's gates still read, so Restore resets a state this report's own Suspend or Ban set (its
 * audit entry records it), and nothing else; and Restore reads every row of each list page by page, so a flood of
 * reports past the server's row cap never hides the one that keeps a change (a list it cannot read in full changes
 * nothing). These run the queue's server functions against the scripted client in moderation-post-reports-test-mock.ts.
 */

vi.mock(
  "@tanstack/react-start",
  async () => (await import("@/lib/moderation-post-reports-test-mock")).reactStart,
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/moderation.server", async () => ({
  assertModerator: (await import("@/lib/moderation-post-reports-test-mock")).h.assertModerator,
}));
vi.mock("@/lib/audit-log.server", async () => ({
  logAdminAction: (await import("@/lib/moderation-post-reports-test-mock")).h.audit,
}));
vi.mock("@/integrations/supabase/client.server", async () => ({
  supabaseAdmin: (await import("@/lib/moderation-post-reports-test-mock")).supabaseAdmin,
}));

import { applyModerationAction } from "@/lib/moderation.functions";
import {
  RESTORE_KEEPS_ACCOUNT,
  RESTORE_KEEPS_HIDDEN,
  RESTORE_KEEPS_STATE,
  RESTORE_KEEPS_WARNING,
  RESTORE_LEFT_AS_IS,
  RESTORE_LEFT_REPORT,
  RESTORE_READ_FAILED,
  RESTORE_REFUSED_PREFIX,
  keptAccountSentence,
  keptStateSentence,
  keptWarningSentence,
  restoreRefusal,
} from "@/lib/post-restore";
import {
  BOOM,
  MINE_ID,
  NONE,
  OTHER_ID,
  T_EARLIER,
  T_LATER,
  T_MINE,
  anyWrites,
  auditCall,
  auditRow,
  author,
  banned,
  freshRestrict,
  h,
  hiddenAt,
  mine,
  ok,
  reports,
  resetMock,
  row,
  writesTo,
  type Result,
} from "@/lib/moderation-post-reports-test-mock";

beforeEach(resetMock);

const act = (action: string, reportId = MINE_ID) =>
  applyModerationAction({ data: { reportId, action, reason: "abuse" } });
const reportUpdate = () => writesTo("user_reports").at(-1);
const keptBan = (why: string) => keptAccountSentence("banned", why);
/** A Restore that undid nothing: it leaves the report as it is, so it can still undo its own action later. */
const nothingUndone = (...kept: string[]) =>
  ["Nothing undone.", ...kept, RESTORE_LEFT_AS_IS].join(" ");
/** A Restore whose write failed: the report stays as it was, so Restore can run again. */
const writeFailed = (...kept: string[]) =>
  ["Nothing undone.", ...kept, RESTORE_LEFT_REPORT].join(" ");

describe("Restore on a post report", () => {
  describe("the author's moderation state, once suspended_at is cleared (finding: dead end after a superadmin's lift)", () => {
    const resetOps = (to = "active", state = "banned") => [
      ["update", { moderation_state: to }],
      ["eq", "id", "author"],
      ["is", "suspended_at", null],
      ["eq", "moderation_state", state],
      ["select", "id"],
    ];

    it("resets the ban this report's own Ban set after a superadmin's Restore account, and dismisses the report", async () => {
      // A1: post-report Ban at T_MINE, then the superadmin's lift cleared suspended_at and left 'banned'
      const r = banned();
      h.answers.user_reports = reports(r);
      h.answers.profiles = [author(null, "banned"), ok()];
      h.answers.admin_audit_log = [ok([freshRestrict(r.id, T_MINE)])];
      const out = await act("restore");
      expect(out.summary).toBe("Ban lifted.");
      expect(writesTo("profiles").map((c) => c.ops)).toEqual([resetOps()]);
      expect(reportUpdate()?.ops[0][1]).toMatchObject({ status: "dismissed" });
      const lift = {
        suspended_at: null,
        moderation_state: "banned",
        moderation_state_after: "active",
      };
      expect(auditCall(0)).toMatchObject({
        metadata: { restore: { lifted: [{ what: "account", ...lift }], reportUpdated: true } },
      });
      expect(auditCall(1)).toMatchObject({
        targetType: "user",
        before: { reportId: r.id, ...lift },
      });
    });

    it("resets it back to 'warned' while another report's warning stands", async () => {
      const r = banned();
      h.answers.user_reports = reports(r, [], [row(OTHER_ID, "resolved", "Warning issued — x")]);
      h.answers.profiles = [author(null, "banned"), ok()];
      h.answers.admin_audit_log = [ok([freshRestrict(r.id, T_MINE)])];
      const out = await act("restore");
      expect(writesTo("profiles").map((c) => c.ops)).toEqual([resetOps("warned")]);
      expect(out.summary).toBe(
        `Ban lifted. ${keptWarningSentence(RESTORE_KEEPS_WARNING.otherReport)}`,
      );
    });

    it("resets a ban this report raised over an image-upload suspension, once that suspension is lifted", async () => {
      // A2: the superadmin suspended at T_EARLIER (state 'active'); this report's Ban kept it and raised the state
      const r = banned({
        resolution_notes: "Account banned (it was already restricted) — abuse",
      });
      const raise = auditRow(
        r.id,
        "user.ban",
        { moderationState: "banned", fresh: false, actedAt: T_MINE },
        T_MINE,
      );
      // while the image-upload suspension stands, everything stays (it is not this report's)
      h.answers.user_reports = reports(r);
      h.answers.profiles = [author(T_EARLIER, "banned")];
      h.answers.admin_audit_log = [ok([raise])];
      const before = await act("restore");
      expect(before.summary).toBe(nothingUndone(keptBan(RESTORE_KEEPS_ACCOUNT.alreadyRestricted)));
      expect(anyWrites()).toEqual([]);

      // once the superadmin lifted it, the ban state this report set is reset
      h.calls = [];
      h.answers.user_reports = reports(r);
      h.answers.profiles = [author(null, "banned"), ok()];
      h.answers.admin_audit_log = [ok([raise])];
      expect((await act("restore")).summary).toBe("Ban lifted.");
      expect(writesTo("profiles").map((c) => c.ops)).toEqual([resetOps()]);
    });

    it("is refused while another report not dismissed suspended or banned the account, however old, when the raise found it restricted", async () => {
      const r = banned({
        resolution_notes: "Account banned (it was already restricted) — abuse",
      });
      h.answers.user_reports = reports(
        r,
        [],
        [row(OTHER_ID, "resolved", "Account suspended — months ago", T_EARLIER)],
      );
      h.answers.profiles = [author(null, "banned")];
      h.answers.admin_audit_log = [
        ok([
          auditRow(
            r.id,
            "user.ban",
            { moderationState: "banned", fresh: false, actedAt: T_MINE },
            T_MINE,
          ),
        ]),
      ];
      await expect(act("restore")).rejects.toThrow(
        restoreRefusal([`The account stays banned: ${RESTORE_KEEPS_ACCOUNT.otherReport}.`]),
      );
      expect(anyWrites()).toEqual([]);
    });

    it("leaves out a report whose last change came before this report's own fresh Ban", async () => {
      const r = banned();
      h.answers.user_reports = reports(
        r,
        [],
        [row(OTHER_ID, "resolved", "Account banned — months ago", T_EARLIER)],
      );
      h.answers.profiles = [author(null, "banned"), ok()];
      h.answers.admin_audit_log = [ok([freshRestrict(r.id, T_MINE)])];
      expect((await act("restore")).summary).toBe("Ban lifted.");
    });

    it("keeps the state when another action may have set it since, or this report's own set another", async () => {
      for (const [entries, state] of [
        // another report's Ban that does not record what it wrote (another kind of report, unguarded)
        [[freshRestrict(MINE_ID, T_MINE), auditRow(OTHER_ID, "user.ban", {}, T_LATER)], "banned"],
        // another report's Ban that recorded the state it wrote
        [
          [
            freshRestrict(MINE_ID, T_MINE),
            auditRow(
              OTHER_ID,
              "user.ban",
              { moderationState: "banned", actedAt: T_LATER },
              T_LATER,
            ),
          ],
          "banned",
        ],
        // its own Suspend set 'suspended'; the state is 'banned' now
        [[freshRestrict(MINE_ID, T_MINE, "user.suspend")], "banned"],
      ] as const) {
        h.calls = [];
        h.answers.user_reports = reports(banned());
        h.answers.profiles = [author(null, state)];
        h.answers.admin_audit_log = [ok([...entries])];
        const out = await act("restore");
        expect(anyWrites()).toEqual([]);
        expect(out.summary).toBe(
          nothingUndone(keptStateSentence(state, RESTORE_KEEPS_STATE.changedSince)),
        );
      }
    });

    it("is not stopped by another report's later action that recorded it wrote no state", async () => {
      h.answers.user_reports = reports(banned());
      h.answers.profiles = [author(null, "banned"), ok()];
      h.answers.admin_audit_log = [
        ok([
          freshRestrict(MINE_ID, T_MINE),
          // a later post-report Ban that found the account banned: it records its writes, and wrote no state
          auditRow(OTHER_ID, "user.ban", { fresh: false, actedAt: T_LATER }, T_LATER),
        ]),
      ];
      expect((await act("restore")).summary).toBe("Ban lifted.");
    });

    it("says why when this report's own actions found the state restricted, or never acted on the account", async () => {
      h.answers.user_reports = reports(
        banned({ resolution_notes: "Account suspended (it was already restricted)" }),
      );
      h.answers.profiles = [author(null, "banned")];
      h.answers.admin_audit_log = [
        ok([auditRow(MINE_ID, "user.suspend", { fresh: false, actedAt: T_MINE }, T_MINE)]),
      ];
      expect((await act("restore")).summary).toBe(
        nothingUndone(keptStateSentence("banned", RESTORE_KEEPS_STATE.already)),
      );

      h.calls = [];
      h.answers.user_reports = reports(mine());
      h.answers.profiles = [author(null, "suspended")];
      h.answers.posts = [hiddenAt(null)];
      h.answers.admin_audit_log = [ok([])];
      expect((await act("restore")).summary).toBe(
        nothingUndone(keptStateSentence("suspended", RESTORE_KEEPS_STATE.notThisReport)),
      );
      expect(anyWrites()).toEqual([]);
    });

    it("keeps the state when it changed between its read and its write, or the reset failed", async () => {
      h.answers.user_reports = reports(banned());
      h.answers.profiles = [author(null, "banned"), NONE];
      h.answers.admin_audit_log = [ok([freshRestrict(MINE_ID, T_MINE)])];
      expect((await act("restore")).summary).toBe(
        nothingUndone(keptStateSentence("banned", RESTORE_KEEPS_STATE.changedSince)),
      );

      h.calls = [];
      h.answers.user_reports = reports(banned());
      h.answers.profiles = [author(null, "banned"), BOOM];
      h.answers.admin_audit_log = [ok([freshRestrict(MINE_ID, T_MINE)])];
      expect((await act("restore")).summary).toBe(
        writeFailed(keptStateSentence("banned", "resetting it failed")),
      );
      expect(writesTo("user_reports")).toEqual([]);
    });

    it("lifts a suspended_at this report filled in on an account already banned, and leaves the ban state it did not set", async () => {
      const r = banned({
        resolution_notes: "Account suspended (it was already restricted) — abuse",
      });
      h.answers.user_reports = reports(r);
      h.answers.profiles = [author(T_MINE, "banned"), ok()];
      h.answers.admin_audit_log = [
        ok([
          auditRow(
            r.id,
            "user.suspend",
            { suspendedAt: T_MINE, fresh: false, actedAt: T_MINE },
            T_MINE,
          ),
        ]),
      ];
      const out = await act("restore");
      expect(writesTo("profiles").map((c) => c.ops)).toEqual([
        [
          ["update", { suspended_at: null, suspended_reason: null }],
          ["eq", "id", "author"],
          ["eq", "suspended_at", T_MINE],
          ["eq", "moderation_state", "banned"],
          ["select", "id"],
        ],
      ]);
      expect(out.summary).toBe(
        `Suspension lifted. ${keptStateSentence("banned", RESTORE_KEEPS_STATE.already)}`,
      );
      expect(auditCall(0)).toMatchObject({
        metadata: {
          restore: {
            lifted: [
              {
                what: "account",
                suspended_at: T_MINE,
                moderation_state: "banned",
                moderation_state_after: "banned",
              },
            ],
          },
        },
      });
    });

    it("counts every other report for a filled-in suspension, however old (the account was restricted)", async () => {
      const r = banned({
        resolution_notes: "Account suspended (it was already restricted) — abuse",
      });
      h.answers.user_reports = reports(
        r,
        [],
        [row(OTHER_ID, "resolved", "Account banned — months ago", T_EARLIER)],
      );
      h.answers.profiles = [author(T_MINE, "banned")];
      h.answers.admin_audit_log = [
        ok([
          auditRow(
            r.id,
            "user.suspend",
            { suspendedAt: T_MINE, fresh: false, actedAt: T_MINE },
            T_MINE,
          ),
        ]),
      ];
      await expect(act("restore")).rejects.toThrow(RESTORE_REFUSED_PREFIX);
      expect(anyWrites()).toEqual([]);
    });
  });

  describe("reads every row of each list (finding: a flood of reports past the row cap)", () => {
    /** One page of a list read: the rows the server sent, and how many it says matched. */
    const page = (rows: unknown[], count: number | null) => ({ data: rows, error: null, count });
    const opsOf = (table: string) => h.calls.filter((c) => c.table === table).map((c) => c.ops);

    it("reads the next page after the last id when the server cut a list short, and sees the report that keeps the hide", async () => {
      // a flood of open reports about the post: the server sends one row of three; the resolved one is on page 2
      const r = mine();
      h.answers.user_reports = [
        ok([r]),
        page([row("aaaaaaaa-0000-4000-8000-000000000001", "new", null)], 3),
        ok([]),
        page(
          [
            row("aaaaaaaa-0000-4000-8000-000000000002", "new", null),
            row(OTHER_ID, "resolved", "duplicate"),
          ],
          2,
        ),
      ];
      h.answers.posts = [hiddenAt(T_MINE)];
      await expect(act("restore")).rejects.toThrow(
        restoreRefusal([`The post stays hidden: ${RESTORE_KEEPS_HIDDEN.otherReport}.`]),
      );
      expect(anyWrites()).toEqual([]);
      const postReads = opsOf("user_reports").filter((ops) =>
        ops.some((o) => o[0] === "eq" && o[1] === "post_id"),
      );
      expect(postReads).toHaveLength(2);
      expect(postReads[1]).toContainEqual(["gt", "id", "aaaaaaaa-0000-4000-8000-000000000001"]);
    });

    it("pages the author's audit entries too, so another report's later Ban past the cap is seen", async () => {
      const r = banned();
      h.answers.user_reports = reports(r);
      h.answers.profiles = [author(null, "banned")];
      h.answers.admin_audit_log = [
        page([{ id: "a-1", ...freshRestrict(r.id, T_MINE) }], 2),
        page([{ id: "a-2", ...auditRow(OTHER_ID, "user.ban", {}, T_LATER) }], 1),
      ];
      const out = await act("restore");
      expect(anyWrites()).toEqual([]);
      expect(out.summary).toBe(
        nothingUndone(keptStateSentence("banned", RESTORE_KEEPS_STATE.changedSince)),
      );
      expect(opsOf("admin_audit_log")[1]).toContainEqual(["gt", "id", "a-1"]);
    });

    it("changes nothing when a list is cut short and the rest cannot be read", async () => {
      for (const [table, answers] of [
        // the server says more rows match, then sends none
        [
          "admin_audit_log",
          [page([{ id: "a-1", ...freshRestrict(MINE_ID, T_MINE) }], 2), page([], 1)],
        ],
        // a page without a count
        ["admin_audit_log", [page([], null)]],
        // a cut-short page whose last row has no id to read on from
        ["admin_audit_log", [page([freshRestrict(MINE_ID, T_MINE)], 2)]],
        // the author's reports: more than the server sent
        [
          "user_reports",
          [ok([banned()]), ok([]), page([row(OTHER_ID, "new", null)], 2), page([], 1)],
        ],
      ] as const) {
        h.calls = [];
        h.audit.mockClear();
        h.answers.user_reports = reports(banned());
        h.answers.profiles = [author(T_MINE, "banned"), ok()];
        h.answers.posts = [hiddenAt(null)];
        h.answers.admin_audit_log = [ok([freshRestrict(MINE_ID, T_MINE)])];
        h.answers[table] = [...answers] as Result[];
        await expect(act("restore")).rejects.toThrow(RESTORE_READ_FAILED);
        expect(anyWrites()).toEqual([]);
        expect(h.audit).not.toHaveBeenCalled();
      }
    });

    it("gives up after 25 pages and changes nothing", async () => {
      h.answers.user_reports = reports(banned());
      h.answers.profiles = [author(T_MINE, "banned"), ok()];
      // every page sends one row and says more remain
      h.answers.admin_audit_log = [page([{ id: "a-1", ...freshRestrict(MINE_ID, T_MINE) }], 5000)];
      await expect(act("restore")).rejects.toThrow(RESTORE_READ_FAILED);
      expect(opsOf("admin_audit_log")).toHaveLength(25);
      expect(anyWrites()).toEqual([]);
    });
  });
});

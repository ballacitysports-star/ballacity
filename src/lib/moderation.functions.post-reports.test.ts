import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Post reports in the moderation queue (20261205100000): a moderator sees the reported post as it is now, whether its
 * text changed after the report, and its context. Remove content hides a post that is not hidden yet; Suspend and Ban
 * restrict an author nobody restricted, and never overwrite or lower a restriction that is there. Restore undoes only
 * this report's own actions (owner decision 2026-11-28): a hide or suspension it wrote that the row still holds (its
 * audit entries record what it wrote; a report acted on before that by its notes and reviewed_at), while no other report
 * keeps it. When another report keeps this report's own action, Restore is refused and changes nothing, so it can undo
 * it later. A failed read changes nothing. user_reports.post_id is read only where it exists, so the queue keeps working
 * before the migration is applied and after its rollback.
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

import { createHash } from "crypto";
import {
  applyModerationAction,
  isMissingPostIdColumn,
  listReports,
} from "@/lib/moderation.functions";
import { postBodyMd5, postEditedSinceReport } from "@/lib/post-fingerprint.server";
import {
  RESTORE_CHECK_FAILED,
  RESTORE_KEEPS_ACCOUNT,
  RESTORE_KEEPS_HIDDEN,
  RESTORE_KEEPS_WARNING,
  RESTORE_KEEPS_STATE,
  RESTORE_LEFT_AS_IS,
  RESTORE_LEFT_REPORT,
  RESTORE_READ_FAILED,
  RESTORE_REFUSED_PREFIX,
  RESTORE_REPORT_CHANGED,
  RESTORE_REPORT_UPDATE_FAILED,
  keptAccountSentence,
  keptPostSentence,
  keptStateSentence,
  keptWarningSentence,
  restoreKeepsHidden,
  restoreRefusal,
} from "@/lib/post-restore";
import {
  BOOM,
  COUNT,
  MINE_ID,
  NONE,
  OTHER_ID,
  PAGE,
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
  report,
  reports,
  resetMock,
  row,
  selectsOf,
  updatesOf,
  writesTo,
  type Result,
} from "@/lib/moderation-post-reports-test-mock";

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

const MISSING_POST_ID = {
  code: "42703",
  message: "column user_reports.post_id does not exist",
};

const visiblePost = (hidden_at: string | null) => ({
  id: "post-1",
  body: "Tryouts Sunday",
  posted_as: "person",
  team_id: null,
  org_id: null,
  audience: "public",
  hidden_at,
  deleted_at: null,
  moderation_status: "approved",
});

beforeEach(resetMock);

describe("listReports with post reports", () => {
  it("reads post_id and shows the reported post with its context", async () => {
    h.answers.user_reports = [{ data: [report()], error: null }];
    h.answers.profiles = [
      {
        data: [
          { id: "reporter", display_name: "Rae", moderation_state: "active", suspended_at: null },
          {
            id: "author",
            display_name: "Coach Al",
            moderation_state: "active",
            suspended_at: null,
          },
        ],
        error: null,
      },
    ];
    h.answers.posts = [
      { data: [{ ...visiblePost(null), posted_as: "team", team_id: "harbor-fc" }], error: null },
    ];

    const out = await listReports({ data: { status: "all", subjectType: "post" } });

    expect(h.assertModerator).toHaveBeenCalledTimes(1);
    expect(selectsOf("user_reports")[0]).toMatch(/, post_id, post_body_md5$/);
    const filter = h.calls[0].ops.find((o) => o[0] === "eq");
    expect(filter).toEqual(["eq", "subject_type", "post"]);
    expect(h.calls.find((c) => c.table === "posts")?.ops.find((o) => o[0] === "in")).toEqual([
      "in",
      "id",
      ["post-1"],
    ]);
    expect(out.reports[0]).toMatchObject({
      subjectType: "post",
      reported: { id: "author", name: "Coach Al" },
      postId: "post-1",
      post: {
        id: "post-1",
        body: "Tryouts Sunday",
        postedAs: "team",
        teamId: "harbor-fc",
        orgId: null,
        audience: "public",
        hidden: false,
        deleted: false,
        moderationStatus: "approved",
        editedSinceReport: false,
        restoreKeepsHidden: null,
      },
    });
  });

  it("says when the post's text changed after the report", async () => {
    h.answers.user_reports = [
      { data: [report({ post_body_md5: md5("ABUSIVE TEXT") })], error: null },
    ];
    h.answers.posts = [
      {
        data: [{ ...visiblePost(null), body: "Have a nice day", moderation_status: "pending" }],
        error: null,
      },
    ];
    const out = await listReports({ data: { status: "all", subjectType: "post" } });
    expect(out.reports[0].post).toMatchObject({ body: "Have a nice day", editedSinceReport: true });
  });

  /** This report, after its own Remove content: its notes, and reviewed_at = the hide's `now`. */
  it("tells a moderator before Restore that another report keeps this report's own hide", async () => {
    const r = mine();
    h.answers.user_reports = [
      { data: [r], error: null },
      // every report about the post that is not dismissed, read whatever the queue's filter
      {
        data: [
          { id: r.id, post_id: "post-1", status: "resolved", resolution_notes: r.resolution_notes },
          { id: OTHER_ID, post_id: "post-1", status: "resolved", resolution_notes: "duplicate" },
        ],
        error: null,
      },
    ];
    h.answers.posts = [{ data: [visiblePost(T_MINE)], error: null }];
    const out = await listReports({ data: { status: "new", subjectType: "post" } });
    const others = h.calls.filter((c) => c.table === "user_reports")[1];
    expect(others.ops).toEqual([
      ["select", "id, post_id, status, resolution_notes", COUNT],
      ["in", "post_id", ["post-1"]],
      ["neq", "status", "dismissed"],
      ...PAGE,
    ]);
    const audit = h.calls.find((c) => c.table === "admin_audit_log");
    expect(audit?.ops).toEqual([
      ["select", "id, action, before, after, created_at", COUNT],
      ["eq", "action", "content.remove"],
      ["eq", "target_type", "post"],
      ["in", "target_id", ["post-1"]],
      ...PAGE,
    ]);
    expect(out.reports[0].post?.restoreKeepsHidden).toBe(RESTORE_KEEPS_HIDDEN.otherReport);
  });

  it("counts another report that is open only when it chose Remove content", async () => {
    const r = mine();
    const card = async (other: Record<string, unknown>, audit: unknown[] = []) => {
      h.calls = [];
      h.answers.user_reports = [
        { data: [r], error: null },
        { data: [{ id: OTHER_ID, post_id: "post-1", ...other }], error: null },
      ];
      h.answers.posts = [{ data: [visiblePost(T_MINE)], error: null }];
      h.answers.admin_audit_log = [{ data: audit, error: null }];
      return (await listReports({ data: { status: "all", subjectType: "post" } })).reports[0].post
        ?.restoreKeepsHidden;
    };
    // a weak open report, or one under investigation without an action, keeps nothing
    expect(await card({ status: "new", resolution_notes: null })).toBeNull();
    expect(await card({ status: "investigating", resolution_notes: "looking" })).toBeNull();
    // an escalated report whose Remove content found the post already hidden still keeps it
    expect(await card({ status: "escalated", resolution_notes: "Post already hidden — x" })).toBe(
      RESTORE_KEEPS_HIDDEN.otherReport,
    );
    // so does one whose notes were replaced, by its audit entry
    expect(
      await card({ status: "escalated", resolution_notes: "senior review" }, [
        auditRow(OTHER_ID, "content.remove"),
      ]),
    ).toBe(RESTORE_KEEPS_HIDDEN.otherReport);
  });

  it("counts only the reports about the same post", async () => {
    const r = mine();
    h.answers.user_reports = [
      { data: [r, report({ id: OTHER_ID, post_id: "post-2" })], error: null },
      {
        data: [
          { id: OTHER_ID, post_id: "post-2", status: "resolved", resolution_notes: "Post hidden" },
        ],
        error: null,
      },
    ];
    h.answers.posts = [{ data: [visiblePost(T_MINE)], error: null }];
    h.answers.admin_audit_log = [{ data: [auditRow(OTHER_ID, "content.remove")], error: null }];
    const out = await listReports({ data: { status: "all", subjectType: "post" } });
    expect(out.reports[0].post).toMatchObject({ id: "post-1", restoreKeepsHidden: null });
  });

  it("knows this report's own hide from its audit entry after a second action on the report", async () => {
    // Remove content at T_MINE, then Warn at T_LATER: the notes and reviewed_at no longer show the hide
    const r = mine({ resolution_notes: "Warning issued — abuse", reviewed_at: T_LATER });
    h.answers.user_reports = [
      { data: [r], error: null },
      {
        data: [
          { id: r.id, post_id: "post-1", status: "resolved", resolution_notes: r.resolution_notes },
        ],
        error: null,
      },
    ];
    h.answers.posts = [{ data: [visiblePost(T_MINE)], error: null }];
    h.answers.admin_audit_log = [
      {
        data: [auditRow(r.id, "content.remove", { hiddenAt: "2026-11-27T11:00:00.123Z" })],
        error: null,
      },
    ];
    const out = await listReports({ data: { status: "all", subjectType: "post" } });
    expect(out.reports[0].post).toMatchObject({ hidden: true, restoreKeepsHidden: null });
  });

  it("says it could not check what Restore keeps when a read for it failed", async () => {
    for (const failing of ["user_reports", "admin_audit_log"] as const) {
      h.calls = [];
      const r = mine();
      h.answers.user_reports = [{ data: [r], error: null }];
      h.answers.posts = [{ data: [visiblePost(T_MINE)], error: null }];
      h.answers.admin_audit_log = [{ data: [], error: null }];
      const failed = { data: null, error: { message: "timeout" } };
      if (failing === "user_reports") h.answers.user_reports.push(failed);
      else h.answers.admin_audit_log = [failed];
      const out = await listReports({ data: { status: "all", subjectType: "post" } });
      expect(out.reports[0].post?.restoreKeepsHidden).toBe(RESTORE_CHECK_FAILED);
    }
    // a visible post has nothing to keep, read or not
    h.answers.user_reports = [
      { data: [mine()], error: null },
      { data: null, error: { message: "x" } },
    ];
    h.answers.posts = [{ data: [visiblePost(null)], error: null }];
    const visible = await listReports({ data: { status: "all", subjectType: "post" } });
    expect(visible.reports[0].post?.restoreKeepsHidden).toBeNull();
  });

  it("says it could not check when a list it reads was cut short and the rest cannot be read, and reads on when it can", async () => {
    const r = mine();
    const cut = {
      data: [
        {
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          post_id: "post-1",
          status: "new",
          resolution_notes: null,
        },
      ],
      error: null,
      count: 2,
    };
    for (const [answers, keeps] of [
      // the rest of the post's reports never comes
      [[cut, { data: [], error: null, count: 1 }], RESTORE_CHECK_FAILED],
      // the rest comes on the next page: a resolved report that keeps this report's own hide
      [
        [
          cut,
          {
            data: [
              { id: OTHER_ID, post_id: "post-1", status: "resolved", resolution_notes: "dup" },
            ],
            error: null,
            count: 1,
          },
        ],
        RESTORE_KEEPS_HIDDEN.otherReport,
      ],
    ] as const) {
      h.calls = [];
      h.answers.user_reports = [{ data: [r], error: null }, ...answers];
      h.answers.posts = [{ data: [visiblePost(T_MINE)], error: null }];
      h.answers.admin_audit_log = [{ data: [], error: null }];
      const out = await listReports({ data: { status: "all", subjectType: "post" } });
      expect(out.reports[0].post?.restoreKeepsHidden).toBe(keeps);
    }
  });

  it("tells a moderator before Restore when the post was hidden again after this report hid it", async () => {
    const r = mine();
    h.answers.user_reports = [
      { data: [r], error: null },
      {
        data: [
          { id: r.id, post_id: "post-1", status: "resolved", resolution_notes: r.resolution_notes },
        ],
        error: null,
      },
    ];
    h.answers.posts = [{ data: [visiblePost(T_LATER)], error: null }];
    const later = await listReports({ data: { status: "all", subjectType: "post" } });
    expect(later.reports[0].post?.restoreKeepsHidden).toBe(RESTORE_KEEPS_HIDDEN.hiddenSince);

    h.answers.user_reports = [
      { data: [r], error: null },
      {
        data: [
          { id: r.id, post_id: "post-1", status: "resolved", resolution_notes: r.resolution_notes },
        ],
        error: null,
      },
    ];
    h.answers.posts = [{ data: [visiblePost(T_MINE)], error: null }];
    const own = await listReports({ data: { status: "all", subjectType: "post" } });
    expect(own.reports[0].post).toMatchObject({ hidden: true, restoreKeepsHidden: null });
  });

  it("keeps a report whose post was deleted for good, without the post", async () => {
    h.answers.user_reports = [{ data: [report({ post_id: null })], error: null }];
    const out = await listReports({ data: { status: "new", subjectType: "all" } });
    expect(h.calls.some((c) => c.table === "posts")).toBe(false);
    expect(h.calls.some((c) => c.table === "admin_audit_log")).toBe(false);
    expect(out.reports[0]).toMatchObject({ subjectType: "post", postId: null, post: null });
  });

  it("reads again without post_id while the column does not exist", async () => {
    const { post_id: _gone, ...old } = report({ subject_type: "user" });
    h.answers.user_reports = [
      { data: null, error: MISSING_POST_ID },
      { data: [old], error: null },
    ];
    const out = await listReports({ data: { status: "all", subjectType: "all" } });
    const reads = selectsOf("user_reports");
    expect(reads).toHaveLength(2);
    expect(reads[0]).toMatch(/post_id/);
    expect(reads[1]).not.toMatch(/post_id/);
    expect(out.reports[0]).toMatchObject({ subjectType: "user", postId: null, post: null });
  });

  it("does not hide any other failure behind the retry", async () => {
    h.answers.user_reports = [
      { data: null, error: { code: "42501", message: "permission denied" } },
    ];
    await expect(listReports({ data: {} as never })).rejects.toThrow("permission denied");
    expect(selectsOf("user_reports")).toHaveLength(1);
  });

  it("accepts the post filter and refuses an unknown one", async () => {
    await expect(listReports({ data: { subjectType: "post" } })).resolves.toBeTruthy();
    await expect(listReports({ data: { subjectType: "comment" } })).rejects.toThrow();
  });
});

describe("the post text fingerprint", () => {
  it("hashes a post's text as Postgres md5(text) does, and tells an edit apart", () => {
    // SELECT md5('Tryouts Sunday at 6 — café') on the local Postgres 16 (UTF8)
    expect(postBodyMd5("Tryouts Sunday at 6 — café")).toBe("24f358094f60ef2e63ec86cfe6991af2");
    expect(postBodyMd5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(postEditedSinceReport("abc", "900150983cd24fb0d6963f7d28e17f72")).toBe(false);
    expect(postEditedSinceReport("abd", "900150983cd24fb0d6963f7d28e17f72")).toBe(true);
    expect(postEditedSinceReport("abc", null)).toBeNull();
    expect(postEditedSinceReport("abc", undefined)).toBeNull();
  });
});

describe("isMissingPostIdColumn", () => {
  it("is true only for a missing post_id or post_body_md5 column", () => {
    expect(isMissingPostIdColumn(MISSING_POST_ID)).toBe(true);
    expect(
      isMissingPostIdColumn({
        code: "42703",
        message: "column user_reports.post_body_md5 does not exist",
      }),
    ).toBe(true);
    expect(
      isMissingPostIdColumn({
        code: "PGRST204",
        message: "Could not find the 'post_id' column of 'user_reports' in the schema cache",
      }),
    ).toBe(true);
    expect(
      isMissingPostIdColumn({ code: "42703", message: "column x.reel_id does not exist" }),
    ).toBe(false);
    expect(isMissingPostIdColumn({ code: "42501", message: "post_id" })).toBe(false);
    expect(isMissingPostIdColumn(null)).toBe(false);
  });
});

describe("applyModerationAction on a post report", () => {
  const act = (action: string, reportId = MINE_ID) =>
    applyModerationAction({ data: { reportId, action, reason: "abuse" } });

  const postWrites = () => writesTo("posts");

  describe("Remove content", () => {
    it("hides a post that is not hidden yet, resolves the report, and records the hide it wrote", async () => {
      h.answers.user_reports = [{ data: [report()], error: null }];
      h.answers.posts = [ok([{ id: "post-1" }])];
      const out = await act("remove_content");
      expect(out.summary).toBe("Post hidden");
      const [hide] = postWrites();
      expect(hide.ops.slice(1)).toEqual([
        ["eq", "id", "post-1"],
        ["is", "hidden_at", null],
        ["select", "id"],
      ]);
      const hiddenAt = (hide.ops[0][1] as { hidden_at: string }).hidden_at;
      expect(Object.keys(hide.ops[0][1] as object)).toEqual(["hidden_at"]);
      const review = updatesOf("user_reports")[0].set as { reviewed_at: string; status: string };
      // one timestamp for the post's hidden_at, the report's reviewed_at and the audit entry
      expect(review).toMatchObject({ status: "resolved", reviewed_at: hiddenAt });
      expect(auditCall()).toMatchObject({
        action: "content.remove",
        targetType: "post",
        targetId: "post-1",
        before: { reportId: MINE_ID },
        after: { summary: "Post hidden", reportedUserId: "author", hiddenAt },
      });
    });

    it("leaves a hide that was already there as it is, and claims nothing", async () => {
      // a superadmin hid the post first; the guarded hide matches no row
      h.answers.user_reports = [{ data: [report()], error: null }];
      h.answers.posts = [NONE];
      const out = await act("remove_content");
      expect(out.summary).toBe("Post already hidden");
      expect(updatesOf("user_reports")[0].set).toMatchObject({
        status: "resolved",
        resolution_notes: "Post already hidden — abuse",
      });
      expect(auditCall().after).toEqual({
        summary: "Post already hidden",
        reportedUserId: "author",
      });
    });

    it("fails without resolving the report when the hide fails", async () => {
      h.answers.user_reports = [{ data: [report()], error: null }];
      h.answers.posts = [BOOM];
      await expect(act("remove_content")).rejects.toThrow("boom");
      expect(updatesOf("user_reports")).toEqual([]);
      expect(h.audit).not.toHaveBeenCalled();
    });

    it("refuses a report whose post is gone", async () => {
      h.answers.user_reports = [{ data: [report({ post_id: null })], error: null }];
      await expect(act("remove_content")).rejects.toThrow(
        "This report has no removable content attached",
      );
      expect(updatesOf("posts")).toEqual([]);
    });
  });

  describe("Suspend, Ban and Warn", () => {
    it("Ban restricts an author nobody restricted, and records the suspension it wrote", async () => {
      h.answers.user_reports = [{ data: [report()], error: null }];
      h.answers.profiles = [ok()];
      const out = await act("ban");
      expect(out.summary).toBe("Account banned");
      const [ban] = writesTo("profiles");
      const set = ban.ops[0][1] as { suspended_at: string };
      expect(set).toEqual({
        suspended_at: expect.any(String),
        suspended_reason: "abuse",
        moderation_state: "banned",
      });
      expect(ban.ops.slice(1)).toEqual([
        ["eq", "id", "author"],
        ["is", "suspended_at", null],
        ["in", "moderation_state", ["active", "warned"]],
        ["select", "id"],
      ]);
      expect(writesTo("profiles")).toHaveLength(1);
      expect(updatesOf("user_reports")[0].set).toMatchObject({ reviewed_at: set.suspended_at });
      expect(auditCall()).toMatchObject({
        action: "user.ban",
        after: {
          summary: "Account banned",
          suspendedAt: set.suspended_at,
          moderationState: "banned",
          fresh: true,
          actedAt: set.suspended_at,
        },
      });
    });

    it("Suspend writes the suspension too", async () => {
      h.answers.user_reports = [{ data: [report()], error: null }];
      h.answers.profiles = [ok()];
      const out = await act("suspend");
      expect(out.summary).toBe("Account suspended");
      expect(writesTo("profiles")[0].ops[0][1]).toMatchObject({ moderation_state: "suspended" });
    });

    it("Ban on an author already suspended keeps that suspension, raises it to a ban, and claims no suspension", async () => {
      // e.g. a superadmin's suspension for an abusive image upload
      h.answers.user_reports = [{ data: [report()], error: null }];
      h.answers.profiles = [NONE, NONE, ok()];
      const out = await act("ban");
      expect(out.summary).toBe("Account banned (it was already restricted)");
      const [fresh, fill, raise] = writesTo("profiles").map((c) => c.ops);
      expect(fresh.slice(1, 3)).toEqual([
        ["eq", "id", "author"],
        ["is", "suspended_at", null],
      ]);
      // only where suspended_at is empty: an existing one, and its reason, stay as they are
      expect(fill).toEqual([
        ["update", { suspended_at: expect.any(String), suspended_reason: "abuse" }],
        ["eq", "id", "author"],
        ["is", "suspended_at", null],
        ["select", "id"],
      ]);
      expect(raise).toEqual([
        ["update", { moderation_state: "banned" }],
        ["eq", "id", "author"],
        ["in", "moderation_state", ["active", "warned", "suspended"]],
        ["select", "id"],
      ]);
      // it wrote the ban state (raised), not the suspension: Restore may undo only that
      expect(auditCall().after).toEqual({
        summary: "Account banned (it was already restricted)",
        reportedUserId: "author",
        moderationState: "banned",
        fresh: false,
        actedAt: expect.any(String),
      });
    });

    it("Ban on an author still banned with suspended_at cleared fills it in, and records that it wrote it", async () => {
      // a superadmin's Restore account cleared suspended_at and left 'banned'
      h.answers.user_reports = [{ data: [report()], error: null }];
      h.answers.profiles = [NONE, ok(), NONE];
      const out = await act("ban");
      expect(out.summary).toBe("Account banned (it was already restricted)");
      const filled = (writesTo("profiles")[1].ops[0][1] as { suspended_at: string }).suspended_at;
      // its own suspended_at, which its Restore may lift; not the ban state, which was there before
      expect(auditCall().after).toEqual({
        summary: "Account banned (it was already restricted)",
        reportedUserId: "author",
        suspendedAt: filled,
        fresh: false,
        actedAt: filled,
      });
    });

    it("Suspend on a banned author never lowers the ban", async () => {
      h.answers.user_reports = [{ data: [report()], error: null }];
      h.answers.profiles = [NONE, NONE, NONE];
      const out = await act("suspend");
      expect(out.summary).toBe("Account suspended (it was already restricted)");
      const raise = writesTo("profiles")[2].ops;
      expect(raise).toContainEqual(["in", "moderation_state", ["active", "warned"]]);
      // it wrote nothing, and says so
      expect(auditCall().after).toEqual({
        summary: "Account suspended (it was already restricted)",
        reportedUserId: "author",
        fresh: false,
        actedAt: expect.any(String),
      });
    });

    it("Suspend or Ban fails without resolving the report when a write fails", async () => {
      for (const answers of [
        [BOOM, NONE, NONE],
        [NONE, BOOM, NONE],
        [NONE, NONE, BOOM],
      ]) {
        h.calls = [];
        h.audit.mockClear();
        h.answers.user_reports = [{ data: [report()], error: null }];
        h.answers.profiles = [...answers];
        await expect(act("ban")).rejects.toThrow("boom");
        expect(updatesOf("user_reports")).toEqual([]);
        expect(h.audit).not.toHaveBeenCalled();
      }
    });

    it("Warn touches the author, never the post, and never lowers a suspension or ban", async () => {
      h.answers.user_reports = [{ data: [report()], error: null }];
      const out = await act("warn");
      expect(out.summary).toBe("Warning issued");
      expect(updatesOf("posts")).toEqual([]);
      expect(writesTo("profiles")[0].ops).toEqual([
        ["update", { moderation_state: "warned" }],
        ["eq", "id", "author"],
        ["in", "moderation_state", ["active", "warned"]],
      ]);
      expect(h.calls.some((c) => c.table === "notifications")).toBe(true);
    });

    it("Warn fails without resolving the report when its write fails", async () => {
      h.answers.user_reports = [{ data: [report()], error: null }];
      h.answers.profiles = [BOOM];
      await expect(act("warn")).rejects.toThrow("boom");
      expect(h.calls.some((c) => c.table === "notifications")).toBe(false);
      expect(updatesOf("user_reports")).toEqual([]);
    });
  });

  describe("Restore", () => {
    const ACTIVE = author(null, "active");
    /** A Restore that undid nothing: it leaves the report as it is, so it can still undo its own action later. */
    const nothingUndone = (...kept: string[]) =>
      ["Nothing undone.", ...kept, RESTORE_LEFT_AS_IS].join(" ");
    /** A Restore whose write failed: the report stays as it was, so Restore can run again. */
    const writeFailed = (...kept: string[]) =>
      ["Nothing undone.", ...kept, RESTORE_LEFT_REPORT].join(" ");
    const reportUpdate = () => writesTo("user_reports").at(-1);

    it("unhides the post when this report's own Remove content hid it, then dismisses the report while it is as read", async () => {
      const r = mine();
      h.answers.user_reports = reports(r);
      h.answers.profiles = [ACTIVE];
      h.answers.posts = [hiddenAt(T_MINE), ok()];
      const out = await act("restore");
      expect(out.summary).toBe("Post unhidden.");
      expect(selectsOf("user_reports")[0]).toMatch(/\breviewed_at\b/);
      // only while hidden_at still holds this report's hide
      expect(postWrites().map((c) => c.ops)).toEqual([
        [
          ["update", { hidden_at: null }],
          ["eq", "id", "post-1"],
          ["eq", "hidden_at", T_MINE],
          ["select", "id"],
        ],
      ]);
      expect(reportUpdate()?.ops).toEqual([
        [
          "update",
          {
            status: "dismissed",
            reviewed_by: "mod-1",
            reviewed_at: expect.any(String),
            resolution_notes: "Post unhidden. — abuse",
          },
        ],
        ["eq", "id", MINE_ID],
        ["eq", "reviewed_at", T_MINE],
        ["select", "id"],
      ]);
      // an account nobody restricted is not written
      expect(writesTo("profiles")).toEqual([]);
      expect(auditCall()).toMatchObject({
        action: "user.restore",
        targetType: "post",
        targetId: "post-1",
        after: { summary: "Post unhidden.", reportedUserId: "author" },
        metadata: {
          restore: { lifted: [{ what: "post", hidden_at: T_MINE }], reportUpdated: true },
        },
      });
      expect(h.audit).toHaveBeenCalledTimes(1);
    });

    it("reads every report about the post and the author that is not dismissed, and the author's actions", async () => {
      const r = mine();
      h.answers.user_reports = reports(r);
      h.answers.profiles = [ACTIVE];
      h.answers.posts = [hiddenAt(null)];
      await act("restore");
      const [, postReads, accountReads] = h.calls.filter((c) => c.table === "user_reports");
      // every row of each list, page by page, each page counted (readAllRows)
      expect(postReads.ops).toEqual([
        ["select", "id, status, resolution_notes", COUNT],
        ["eq", "post_id", "post-1"],
        ["neq", "status", "dismissed"],
        ...PAGE,
      ]);
      expect(accountReads.ops).toEqual([
        ["select", "id, status, resolution_notes, reviewed_at", COUNT],
        ["eq", "reported_id", "author"],
        ["neq", "status", "dismissed"],
        ...PAGE,
      ]);
      expect(h.calls.find((c) => c.table === "admin_audit_log")?.ops).toEqual([
        ["select", "id, action, before, after, created_at", COUNT],
        ["eq", "after->>reportedUserId", "author"],
        ["in", "action", ["content.remove", "user.suspend", "user.ban", "user.warn"]],
        ...PAGE,
      ]);
      expect(selectsOf("profiles")[0]).toBe("id, suspended_at, suspended_reason, moderation_state");
    });

    it("leaves a post hidden that a superadmin hid after this report's Remove content", async () => {
      h.answers.user_reports = reports(mine());
      h.answers.posts = [hiddenAt(T_LATER)];
      const out = await act("restore");
      expect(postWrites()).toEqual([]);
      const summary = nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.hiddenSince));
      expect(out.summary).toBe(summary);
      expect(auditCall()).toMatchObject({
        after: { summary },
        metadata: { restore: { lifted: [], reportUpdated: false } },
      });
      // nothing undone: the report keeps its status, notes and reviewed_at
      expect(writesTo("user_reports")).toEqual([]);
    });

    it("leaves a hide that was there before this report's Remove content (superadmin at T0, Remove content at T1)", async () => {
      // Remove content found the post hidden: its notes say so, and it recorded no hide
      const r = mine({ resolution_notes: "Post already hidden — abuse" });
      h.answers.user_reports = reports(r);
      h.answers.posts = [hiddenAt(T_EARLIER)];
      h.answers.admin_audit_log = [ok([auditRow(r.id, "content.remove")])];
      const out = await act("restore");
      expect(postWrites()).toEqual([]);
      expect(out.summary).toBe(nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.alreadyHidden)));
    });

    it("leaves a post hidden that this report's latest action did not hide, and the report as it is", async () => {
      for (const notes of [null, "Warning issued — abuse", "Post unhidden."]) {
        h.calls = [];
        h.answers.user_reports = reports(mine({ resolution_notes: notes }));
        h.answers.posts = [hiddenAt(T_MINE)];
        const out = await act("restore");
        expect(postWrites()).toEqual([]);
        expect(out.summary).toBe(
          nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.notThisReport)),
        );
        expect(writesTo("user_reports")).toEqual([]);
      }
    });

    it("leaves the post hidden once this report's reviewed_at changed after its Remove content (no audit entry)", async () => {
      h.answers.user_reports = reports(mine({ status: "escalated", reviewed_at: T_LATER }));
      h.answers.posts = [hiddenAt(T_MINE)];
      const out = await act("restore");
      expect(postWrites()).toEqual([]);
      expect(out.summary).toBe(nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.hiddenSince)));
    });

    describe("refused while another report keeps this report's own action (nothing changes)", () => {
      const expectNothingChanged = () => {
        expect(anyWrites()).toEqual([]);
        expect(h.audit).not.toHaveBeenCalled();
      };

      it("refuses while another report about the post is resolved, then unhides once it is dismissed", async () => {
        const r = mine();
        h.answers.user_reports = reports(r, [
          row(r.id, "resolved", r.resolution_notes),
          row(OTHER_ID, "resolved", "duplicate"),
        ]);
        h.answers.profiles = [ACTIVE];
        h.answers.posts = [hiddenAt(T_MINE)];
        await expect(act("restore")).rejects.toThrow(
          restoreRefusal([`The post stays hidden: ${RESTORE_KEEPS_HIDDEN.otherReport}.`]),
        );
        expectNothingChanged();

        // the other report is dismissed (it is no longer read); this report is as it was, so Restore undoes its hide
        h.calls = [];
        h.answers.user_reports = reports(r, [row(r.id, "resolved", r.resolution_notes)]);
        h.answers.profiles = [ACTIVE];
        h.answers.posts = [hiddenAt(T_MINE), ok()];
        expect((await act("restore")).summary).toBe("Post unhidden.");
      });

      it("refuses while an escalated report chose Remove content on the post (it found the post already hidden)", async () => {
        const r = mine();
        h.answers.user_reports = reports(r, [
          row(OTHER_ID, "escalated", "Post already hidden — x"),
        ]);
        h.answers.posts = [hiddenAt(T_MINE)];
        await expect(act("restore")).rejects.toThrow(RESTORE_REFUSED_PREFIX);
        expectNothingChanged();
      });

      it("is not refused by an open report about the post that chose nothing", async () => {
        const r = mine();
        h.answers.user_reports = reports(r, [
          row(OTHER_ID, "new", null),
          row(OTHER_ID, "investigating", "looking"),
        ]);
        h.answers.posts = [hiddenAt(T_MINE), ok()];
        expect((await act("restore")).summary).toBe("Post unhidden.");
      });

      it("refuses while another report not dismissed banned the author too, for this report's own ban", async () => {
        const r = mine({ resolution_notes: "Account banned — abuse" });
        h.answers.user_reports = reports(
          r,
          [],
          [row(OTHER_ID, "escalated", "Account banned (it was already restricted) — x")],
        );
        h.answers.profiles = [author(T_MINE, "banned")];
        h.answers.admin_audit_log = [ok([freshRestrict(r.id, T_MINE)])];
        await expect(act("restore")).rejects.toThrow(
          restoreRefusal([`The account stays banned: ${RESTORE_KEEPS_ACCOUNT.otherReport}.`]),
        );
        expectNothingChanged();
      });

      it("is not refused for an account this report never restricted, whoever else did", async () => {
        const r = mine({ resolution_notes: null });
        h.answers.user_reports = reports(r, [], [row(OTHER_ID, "resolved", "Account banned — x")]);
        h.answers.profiles = [author(T_LATER, "banned")];
        const out = await act("restore");
        expect(out.summary).toBe(
          nothingUndone(keptAccountSentence("banned", RESTORE_KEEPS_ACCOUNT.notThisReport)),
        );
        expect(writesTo("profiles")).toEqual([]);
        expect(writesTo("user_reports")).toEqual([]);
      });

      it("refuses by another report's audit entry when a later action replaced its notes", async () => {
        const r = mine({ resolution_notes: "Account suspended — abuse" });
        h.answers.user_reports = reports(
          r,
          [],
          [row(OTHER_ID, "resolved", "Warning issued — later")],
        );
        h.answers.profiles = [author(T_MINE, "suspended")];
        h.answers.admin_audit_log = [
          ok([
            freshRestrict(r.id, T_MINE, "user.suspend"),
            auditRow(OTHER_ID, "user.ban", {}, T_LATER),
          ]),
        ];
        await expect(act("restore")).rejects.toThrow(RESTORE_REFUSED_PREFIX);
        expectNothingChanged();
      });

      it("undoes nothing of a stacked pair until the other is dismissed, in either order", async () => {
        // ME hid the post at T_MINE; OTHER's later Remove content found it hidden.
        const me = mine();
        const other = mine({
          id: OTHER_ID,
          resolution_notes: "Post already hidden — dup",
          reviewed_at: T_LATER,
        });
        const both = [
          row(me.id, "resolved", me.resolution_notes),
          row(OTHER_ID, "resolved", other.resolution_notes),
        ];
        // Restore OTHER first: it owns nothing, so nothing is undone and OTHER stays as it is (still resolved)
        h.answers.user_reports = reports(other, both);
        h.answers.posts = [hiddenAt(T_MINE)];
        const first = await act("restore", OTHER_ID);
        expect(first.summary).toBe(
          nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.alreadyHidden)),
        );
        expect(anyWrites()).toEqual([]);

        // so ME is still refused while OTHER stands, and changes nothing
        h.calls = [];
        h.answers.user_reports = reports(me, both);
        h.answers.posts = [hiddenAt(T_MINE)];
        await expect(act("restore")).rejects.toThrow(RESTORE_REFUSED_PREFIX);
        expect(anyWrites()).toEqual([]);

        // once a moderator dismisses OTHER (it is no longer read), ME undoes its own hide
        h.calls = [];
        h.answers.user_reports = reports(me, [both[0]]);
        h.answers.posts = [hiddenAt(T_MINE), ok()];
        expect((await act("restore")).summary).toBe("Post unhidden.");
      });
    });

    describe("after a second action on the same report (its audit entries)", () => {
      it("Remove content then Warn: Restore clears the warning and unhides the post", async () => {
        const r = mine({ resolution_notes: "Warning issued — abuse", reviewed_at: T_LATER });
        h.answers.user_reports = reports(r, [row(r.id, "resolved", r.resolution_notes)]);
        h.answers.profiles = [author(null, "warned"), ok()];
        h.answers.posts = [hiddenAt(T_MINE), ok()];
        h.answers.admin_audit_log = [
          ok([
            auditRow(r.id, "content.remove", { hiddenAt: T_MINE }),
            auditRow(r.id, "user.warn", {}, T_LATER),
          ]),
        ];
        const out = await act("restore");
        expect(out.summary).toBe("Warning cleared, post unhidden.");
        expect(reportUpdate()?.ops).toContainEqual(["eq", "reviewed_at", T_LATER]);
      });

      it("Remove content then Ban: Restore lifts the ban and unhides the post", async () => {
        const r = mine({ resolution_notes: "Account banned — abuse", reviewed_at: T_LATER });
        h.answers.user_reports = reports(r);
        h.answers.profiles = [author(T_LATER, "banned"), ok()];
        h.answers.posts = [hiddenAt(T_MINE), ok()];
        h.answers.admin_audit_log = [
          ok([
            auditRow(r.id, "content.remove", { hiddenAt: T_MINE }),
            freshRestrict(r.id, T_LATER),
          ]),
        ];
        expect((await act("restore")).summary).toBe("Ban lifted, post unhidden.");
      });

      it("Ban then Remove content: Restore lifts the ban and unhides the post", async () => {
        const r = mine({ reviewed_at: T_LATER });
        h.answers.user_reports = reports(r);
        h.answers.profiles = [author(T_MINE, "banned"), ok()];
        h.answers.posts = [hiddenAt(T_LATER), ok()];
        h.answers.admin_audit_log = [
          ok([
            freshRestrict(r.id, T_MINE),
            auditRow(r.id, "content.remove", { hiddenAt: T_LATER }, T_LATER),
          ]),
        ];
        expect((await act("restore")).summary).toBe("Ban lifted, post unhidden.");
      });

      it("a Restore that kept the hide for another reason does not stop a later Restore that may undo it", async () => {
        // this report's notes now hold an earlier Restore's summary; its audit entry still shows its own hide
        const r = mine({
          status: "dismissed",
          resolution_notes: "Nothing undone. x",
          reviewed_at: T_LATER,
        });
        h.answers.user_reports = reports(r);
        h.answers.posts = [hiddenAt(T_MINE), ok()];
        h.answers.admin_audit_log = [ok([auditRow(r.id, "content.remove", { hiddenAt: T_MINE })])];
        expect((await act("restore")).summary).toBe("Post unhidden.");
      });
    });

    describe("changes made while it runs, and failed writes", () => {
      it("keeps a hide made between its read and its write", async () => {
        h.answers.user_reports = reports(mine());
        // the read sees this report's hide; the guarded unhide then matches no row
        h.answers.posts = [hiddenAt(T_MINE), NONE];
        const out = await act("restore");
        expect(postWrites()).toHaveLength(1);
        expect(out.summary).toBe(nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.hiddenSince)));
      });

      it("leaves the report as it was when unhiding failed, so Restore can run again", async () => {
        h.answers.user_reports = reports(mine());
        h.answers.posts = [hiddenAt(T_MINE), BOOM];
        const out = await act("restore");
        expect(out.summary).toBe(writeFailed(keptPostSentence("unhiding it failed")));
        expect(writesTo("user_reports")).toEqual([]);
        expect(auditCall()).toMatchObject({
          metadata: { restore: { lifted: [], reportUpdated: false } },
        });
      });

      it("says so, and keeps the report's status and notes, when the report changed while it ran", async () => {
        // another moderator acted on this report meanwhile: the guarded update matches no row
        h.answers.user_reports = reports(mine(), [], [], NONE);
        h.answers.posts = [hiddenAt(T_MINE), ok()];
        const out = await act("restore");
        expect(out.summary).toBe(`Post unhidden. ${RESTORE_REPORT_CHANGED}`);
        expect(auditCall()).toMatchObject({
          after: { summary: out.summary },
          metadata: { restore: { reportUpdated: false } },
        });
      });

      it("says so when updating the report failed, after what it undid", async () => {
        h.answers.user_reports = reports(mine(), [], [], BOOM);
        h.answers.posts = [hiddenAt(T_MINE), ok()];
        const out = await act("restore");
        expect(out.summary).toBe(`Post unhidden. ${RESTORE_REPORT_UPDATE_FAILED}`);
        expect(auditCall()).toMatchObject({ metadata: { restore: { reportUpdated: false } } });
      });

      it("guards a report never reviewed on reviewed_at being empty", async () => {
        // its audit entry shows its own hide, though reviewed_at is empty
        h.answers.user_reports = reports(report());
        h.answers.posts = [hiddenAt(T_MINE), ok()];
        h.answers.admin_audit_log = [
          ok([auditRow(MINE_ID, "content.remove", { hiddenAt: T_MINE })]),
        ];
        const out = await act("restore");
        expect(out.summary).toBe("Post unhidden.");
        expect(reportUpdate()?.ops).toContainEqual(["is", "reviewed_at", null]);
      });

      it("writes nothing to a post that is already visible, and leaves the report as it is", async () => {
        h.answers.user_reports = reports(mine());
        h.answers.profiles = [ACTIVE];
        h.answers.posts = [hiddenAt(null)];
        const out = await act("restore");
        expect(out.summary).toBe(`Nothing to undo. ${RESTORE_LEFT_AS_IS}`);
        expect(anyWrites()).toEqual([]);
        expect(auditCall()).toMatchObject({
          metadata: { restore: { lifted: [], reportUpdated: false } },
        });
      });
    });

    describe("the author's account (only this report's own Suspend or Ban is lifted)", () => {
      const keptBan = (why: string) => keptAccountSentence("banned", why);
      const liftOps = (to = "active", state = "banned") => [
        ["update", { suspended_at: null, suspended_reason: null, moderation_state: to }],
        ["eq", "id", "author"],
        ["eq", "suspended_at", T_MINE],
        ["eq", "moderation_state", state],
        ["select", "id"],
      ];

      it("lifts this report's own ban, only while suspended_at and moderation_state still hold it, and audits it on the user", async () => {
        const r = banned();
        h.answers.user_reports = reports(r, [], [row(r.id, "resolved", r.resolution_notes)]);
        h.answers.profiles = [author(T_MINE, "banned"), ok()];
        h.answers.posts = [hiddenAt(null)];
        const out = await act("restore");
        expect(out.summary).toBe("Ban lifted.");
        expect(writesTo("profiles").map((c) => c.ops)).toEqual([liftOps()]);
        const lift = {
          suspended_at: T_MINE,
          suspended_reason: "abuse",
          moderation_state: "banned",
          moderation_state_after: "active",
        };
        expect(auditCall(0)).toMatchObject({
          metadata: { restore: { lifted: [{ what: "account", ...lift }] } },
        });
        expect(auditCall(1)).toMatchObject({
          action: "user.restore",
          targetType: "user",
          targetId: "author",
          before: { reportId: MINE_ID, ...lift },
          after: { summary: "Ban lifted." },
        });
      });

      it("lifts this report's own suspension", async () => {
        h.answers.user_reports = reports(banned({ resolution_notes: "Account suspended — abuse" }));
        h.answers.profiles = [author("2026-11-27T11:00:00.123Z", "suspended"), ok()];
        const out = await act("restore");
        expect(out.summary).toBe("Suspension lifted.");
        expect(writesTo("profiles")).toHaveLength(1);
      });

      it("lifts back to 'warned' while another report's warning stands", async () => {
        const r = banned();
        h.answers.user_reports = reports(r, [], [row(OTHER_ID, "resolved", "Warning issued — x")]);
        h.answers.profiles = [author(T_MINE, "banned"), ok()];
        const out = await act("restore");
        expect(writesTo("profiles")[0].ops).toEqual(liftOps("warned"));
        expect(out.summary).toBe(
          `Ban lifted. ${keptWarningSentence(RESTORE_KEEPS_WARNING.otherReport)}`,
        );
      });

      it("never lifts a ban this report did not make, even while this report's own hide is undone", async () => {
        h.answers.user_reports = reports(mine());
        h.answers.profiles = [author(T_LATER, "banned")];
        h.answers.posts = [hiddenAt(T_MINE), ok()];
        const out = await act("restore");
        expect(writesTo("profiles")).toEqual([]);
        expect(postWrites()).toHaveLength(1);
        expect(out.summary).toBe(`Post unhidden. ${keptBan(RESTORE_KEEPS_ACCOUNT.notThisReport)}`);
      });

      it("never lifts a suspension that was there before this report's Ban (an image-upload suspension)", async () => {
        // the superadmin suspended at T_EARLIER; this report's Ban kept it and raised it to a ban
        h.answers.user_reports = reports(
          banned({ resolution_notes: "Account banned (it was already restricted) — abuse" }),
        );
        h.answers.profiles = [author(T_EARLIER, "banned")];
        h.answers.admin_audit_log = [ok([auditRow(MINE_ID, "user.ban")])];
        const out = await act("restore");
        expect(writesTo("profiles")).toEqual([]);
        expect(out.summary).toBe(nothingUndone(keptBan(RESTORE_KEEPS_ACCOUNT.alreadyRestricted)));
      });

      it("never lifts a ban whose suspended_at this report filled in on an account already banned", async () => {
        // a superadmin had cleared suspended_at and left 'banned'; this report's Suspend filled suspended_at in
        h.answers.user_reports = reports(
          banned({ resolution_notes: "Account suspended (it was already restricted)" }),
        );
        h.answers.profiles = [author(T_MINE, "banned")];
        const out = await act("restore");
        expect(writesTo("profiles")).toEqual([]);
        expect(out.summary).toBe(nothingUndone(keptBan(RESTORE_KEEPS_ACCOUNT.alreadyRestricted)));
      });

      it("leaves out another report whose ban was lifted before this report's own new ban", async () => {
        const r = banned();
        h.answers.user_reports = reports(
          r,
          [],
          [row(OTHER_ID, "resolved", "Account banned — months ago", T_EARLIER)],
        );
        h.answers.profiles = [author(T_MINE, "banned"), ok()];
        h.answers.admin_audit_log = [ok([freshRestrict(r.id, T_MINE)])];
        expect((await act("restore")).summary).toBe("Ban lifted.");
      });

      it("counts that old report when this report's own ban is known only by its notes", async () => {
        const r = banned();
        h.answers.user_reports = reports(
          r,
          [],
          [row(OTHER_ID, "resolved", "Account banned — months ago", T_EARLIER)],
        );
        h.answers.profiles = [author(T_MINE, "banned")];
        await expect(act("restore")).rejects.toThrow(RESTORE_REFUSED_PREFIX);
        expect(anyWrites()).toEqual([]);
      });

      it("does not count another report whose notes and audit entries claim no suspension or ban", async () => {
        h.answers.user_reports = reports(
          banned(),
          [],
          [row(OTHER_ID, "resolved", "Accountability note")],
        );
        h.answers.profiles = [author(T_MINE, "banned"), ok()];
        h.answers.admin_audit_log = [ok([auditRow(OTHER_ID, "content.remove", {}, T_LATER)])];
        expect((await act("restore")).summary).toBe("Ban lifted.");
      });

      it("keeps a ban made or changed after this report's own (a later superadmin suspension, reviewed_at changed)", async () => {
        for (const [suspendedAt, reviewedAt] of [
          [T_LATER, T_MINE],
          [T_MINE, T_LATER],
          ["2026-11-27T11:00:00.123001+00:00", T_MINE],
        ]) {
          h.calls = [];
          h.answers.user_reports = reports(banned({ reviewed_at: reviewedAt }));
          h.answers.profiles = [author(suspendedAt, "banned")];
          const out = await act("restore");
          expect(writesTo("profiles")).toEqual([]);
          expect(out.summary).toBe(nothingUndone(keptBan(RESTORE_KEEPS_ACCOUNT.changedSince)));
        }
      });

      it("keeps a ban whose suspension a superadmin lifted when only its notes claim it (still 'banned'), and names no screen", async () => {
        h.answers.user_reports = reports(banned());
        h.answers.profiles = [author(null, "banned")];
        const out = await act("restore");
        expect(writesTo("profiles")).toEqual([]);
        expect(out.summary).toBe(
          nothingUndone(keptStateSentence("banned", RESTORE_KEEPS_STATE.unknown)),
        );
        expect(out.summary).not.toMatch(/superadmin|Restore account/);
      });

      it("keeps a ban or lift made between its read and its write", async () => {
        h.answers.user_reports = reports(banned());
        h.answers.profiles = [author(T_MINE, "banned"), NONE];
        const out = await act("restore");
        expect(writesTo("profiles")).toHaveLength(1);
        expect(out.summary).toBe(nothingUndone(keptBan(RESTORE_KEEPS_ACCOUNT.changedSince)));
        expect(h.audit).toHaveBeenCalledTimes(1);
      });

      it("leaves the report as it was when lifting the ban failed", async () => {
        h.answers.user_reports = reports(banned());
        h.answers.profiles = [author(T_MINE, "banned"), BOOM];
        const out = await act("restore");
        expect(out.summary).toBe(writeFailed(keptBan("lifting it failed")));
        expect(writesTo("user_reports")).toEqual([]);
      });

      it("clears a warning this report issued, only while the author is still just warned", async () => {
        h.answers.user_reports = reports(mine({ resolution_notes: "Warning issued — abuse" }));
        h.answers.profiles = [author(null, "warned"), ok()];
        const out = await act("restore");
        expect(out.summary).toBe("Warning cleared.");
        expect(writesTo("profiles").map((c) => c.ops)).toEqual([
          [
            ["update", { moderation_state: "active" }],
            ["eq", "id", "author"],
            ["eq", "moderation_state", "warned"],
            ["select", "id"],
          ],
        ]);
      });

      it("keeps a warning this report did not issue, or another report issued too", async () => {
        h.answers.user_reports = reports(mine());
        h.answers.profiles = [author(null, "warned")];
        h.answers.posts = [hiddenAt(null)];
        const notMine = await act("restore");
        expect(writesTo("profiles")).toEqual([]);
        expect(notMine.summary).toBe(
          nothingUndone(keptWarningSentence(RESTORE_KEEPS_WARNING.notThisReport)),
        );

        h.calls = [];
        h.answers.user_reports = reports(
          mine({ resolution_notes: "Warning issued" }),
          [],
          [row(OTHER_ID, "escalated", "Warning issued — x")],
        );
        h.answers.profiles = [author(null, "warned")];
        const shared = await act("restore");
        expect(writesTo("profiles")).toEqual([]);
        expect(shared.summary).toBe(
          nothingUndone(keptWarningSentence(RESTORE_KEEPS_WARNING.otherReport)),
        );
      });

      it("leaves the report as it was when clearing the warning failed", async () => {
        h.answers.user_reports = reports(mine({ resolution_notes: "Warning issued" }));
        h.answers.profiles = [author(null, "warned"), BOOM];
        const out = await act("restore");
        expect(out.summary).toBe(writeFailed(keptWarningSentence("clearing it failed")));
        expect(writesTo("user_reports")).toEqual([]);
      });

      it("does not lift the author by id on a post report whose post was deleted for good", async () => {
        // no post reads: the report, the author's reports, then the guarded update
        const r = mine({ post_id: null });
        h.answers.user_reports = [ok([r]), ok([]), ok([{ id: r.id }])];
        h.answers.profiles = [author(T_LATER, "banned")];
        const out = await act("restore");
        expect(h.calls.some((c) => c.table === "posts")).toBe(false);
        expect(writesTo("profiles")).toEqual([]);
        expect(out.summary).toBe(nothingUndone(keptBan(RESTORE_KEEPS_ACCOUNT.notThisReport)));
        expect(writesTo("user_reports")).toEqual([]);
      });
    });

    describe("changes nothing when a read fails (fail closed)", () => {
      const READS = [
        ["the post", "posts", 0],
        ["the post's reports", "user_reports", 1],
        ["the author's profile", "profiles", 0],
        ["the author's reports", "user_reports", 2],
        ["the author's audit entries", "admin_audit_log", 0],
      ] as const;
      for (const [what, table, index] of READS) {
        it(`when reading ${what} fails`, async () => {
          const r = mine();
          // R2 about the same post was resolved without a re-hide; this report's own hide is still in place
          h.answers.user_reports = reports(r, [row(OTHER_ID, "resolved", "duplicate")]);
          h.answers.profiles = [author(T_LATER, "banned")];
          h.answers.posts = [hiddenAt(T_MINE)];
          h.answers.admin_audit_log = [ok([])];
          const failed = { data: null, error: { message: "timeout" } };
          if (table === "user_reports") h.answers.user_reports[index] = failed;
          else h.answers[table] = [failed];
          await expect(act("restore")).rejects.toThrow(RESTORE_READ_FAILED);
          expect(anyWrites()).toEqual([]);
          expect(h.audit).not.toHaveBeenCalled();
        });
      }
    });
  });

  it("Restore on any other kind of report is unchanged here", async () => {
    // Part of owner decision (b), not of post reports: the user, game, reel and message paths stay as on main.
    h.answers.user_reports = [
      { data: [report({ subject_type: "user", post_id: null })], error: null },
    ];
    const out = await act("restore");
    expect(out.summary).toBe("Access and content restored");
    expect(updatesOf("profiles")[0]).toMatchObject({
      set: { suspended_at: null, moderation_state: "active" },
      where: ["id", "author"],
    });
  });

  it("acts on other kinds of report as on main (Suspend, Ban and Warn write unguarded)", async () => {
    h.answers.user_reports = [
      { data: [report({ subject_type: "user", post_id: null })], error: null },
    ];
    expect((await act("ban")).summary).toBe("Account banned");
    expect(writesTo("profiles")[0].ops).toEqual([
      [
        "update",
        { suspended_at: expect.any(String), suspended_reason: "abuse", moderation_state: "banned" },
      ],
      ["eq", "id", "author"],
    ]);
    expect(auditCall().after).toEqual({ summary: "Account banned", reportedUserId: "author" });
  });

  it("still acts on other reports while post_id does not exist", async () => {
    const { post_id: _gone, ...old } = report({ subject_type: "game", game_id: "g-1" });
    h.answers.user_reports = [
      { data: null, error: MISSING_POST_ID },
      { data: [old], error: null },
    ];
    const out = await act("remove_content");
    expect(out.summary).toBe("Game hidden");
    expect(updatesOf("hosted_games")[0].where).toEqual(["id", "g-1"]);
    expect(h.calls.some((c) => c.table === "posts")).toBe(false);
  });
});

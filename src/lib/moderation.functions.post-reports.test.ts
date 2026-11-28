import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Post reports in the moderation queue (20261205100000): a moderator sees the reported post as it is now, whether its
 * text changed after the report, and its context. Remove content hides it; Restore unhides it only when this report's own
 * Remove content hid it, the post's hidden_at is still that hide's timestamp (the report's reviewed_at), and no other
 * report about it was acted on, and lifts the author's suspension or ban only by the same rule for this report's own
 * Suspend or Ban (owner decision 2026-11-28). A failed read changes nothing. user_reports.post_id is read only where it
 * exists, so the queue keeps working before the migration is applied and after its rollback.
 */

// A server function is its handler for these tests: validate the input, then run it.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (d: unknown) => d;
    const b = {
      middleware() {
        return b;
      },
      inputValidator(fn: (d: unknown) => unknown) {
        validate = fn;
        return b;
      },
      handler(fn: (ctx: { data: unknown; context: unknown }) => unknown) {
        return async (arg?: { data?: unknown }) =>
          fn({ data: validate(arg?.data), context: { userId: "mod-1", supabase: {} } });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

type Result = { data: unknown; error: { code?: string; message?: string } | null };
type Call = { table: string; ops: [string, ...unknown[]][] };

const h = vi.hoisted(() => ({
  calls: [] as Call[],
  /** Answers per table, in order; the last one repeats. */
  answers: {} as Record<string, Result[]>,
  assertModerator: vi.fn(async (..._args: unknown[]) => undefined),
  audit: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock("@/lib/moderation.server", () => ({ assertModerator: h.assertModerator }));
vi.mock("@/lib/audit-log.server", () => ({ logAdminAction: h.audit }));
vi.mock("@/integrations/supabase/client.server", () => {
  const answer = (table: string): Result => {
    const list = h.answers[table] ?? [];
    return (list.length > 1 ? list.shift() : list[0]) ?? { data: [], error: null };
  };
  const supabaseAdmin = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      h.calls.push(call);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "like", "order", "limit", "update", "insert"]) {
        q[m] = (...args: unknown[]) => {
          call.ops.push([m, ...args]);
          return q;
        };
      }
      q.maybeSingle = () => {
        call.ops.push(["maybeSingle"]);
        const r = answer(table);
        return Promise.resolve({
          ...r,
          data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
        });
      };
      q.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(answer(table)).then(resolve, reject);
      return q;
    },
  };
  return { supabaseAdmin };
});

import { createHash } from "crypto";
import {
  applyModerationAction,
  isMissingPostIdColumn,
  listReports,
} from "@/lib/moderation.functions";
import { postBodyMd5, postEditedSinceReport } from "@/lib/post-fingerprint.server";
import {
  RESTORE_KEEPS_ACCOUNT,
  RESTORE_KEEPS_HIDDEN,
  RESTORE_READ_FAILED,
  accountRestoreBlocker,
  keptAccountSentence,
  keptPostSentence,
  postRestoreBlocker,
  restoreKeepsHidden,
  restoreSummary,
  timestampMicros,
} from "@/lib/post-restore";

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

const MISSING_POST_ID = {
  code: "42703",
  message: "column user_reports.post_id does not exist",
};

/** This report's Remove content: hidden_at and reviewed_at as PostgREST returns them, from one `now`. */
const T_MINE = "2026-11-27T11:00:00.123+00:00";
/** A later moment: a superadmin's or another moderator's hide, or a later change to this report. */
const T_LATER = "2026-11-27T12:30:00.456+00:00";

const report = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  subject_type: "post",
  reason: "harassment",
  details: "nasty",
  status: "new",
  created_at: "2026-11-27T10:00:00Z",
  reviewed_at: null,
  resolution_notes: null,
  reporter_id: "reporter",
  reported_id: "author",
  game_id: null,
  conversation_id: null,
  message_id: null,
  reel_id: null,
  post_id: "post-1",
  post_body_md5: md5("Tryouts Sunday"),
  ...over,
});

const selectsOf = (table: string) =>
  h.calls
    .filter((c) => c.table === table)
    .flatMap((c) => c.ops.filter((o) => o[0] === "select").map((o) => String(o[1])));
const updatesOf = (table: string) =>
  h.calls
    .filter((c) => c.table === table)
    .flatMap((c) => {
      const update = c.ops.find((o) => o[0] === "update");
      const eq = c.ops.find((o) => o[0] === "eq");
      return update ? [{ set: update[1], where: eq?.slice(1) }] : [];
    });

beforeEach(() => {
  h.calls = [];
  h.answers = {};
  h.assertModerator.mockClear();
  h.audit.mockClear();
});

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
      {
        data: [
          {
            id: "post-1",
            body: "Tryouts Sunday",
            posted_as: "team",
            team_id: "harbor-fc",
            org_id: null,
            audience: "public",
            hidden_at: null,
            deleted_at: null,
            moderation_status: "approved",
          },
        ],
        error: null,
      },
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
        data: [
          {
            id: "post-1",
            body: "Have a nice day",
            posted_as: "person",
            team_id: null,
            org_id: null,
            audience: "public",
            hidden_at: null,
            deleted_at: null,
            moderation_status: "pending",
          },
        ],
        error: null,
      },
    ];
    const out = await listReports({ data: { status: "all", subjectType: "post" } });
    expect(out.reports[0].post).toMatchObject({ body: "Have a nice day", editedSinceReport: true });
  });

  it("tells a moderator before Restore that it would leave a hidden post hidden", async () => {
    const hiddenPost = {
      id: "post-1",
      body: "Tryouts Sunday",
      posted_as: "person",
      team_id: null,
      org_id: null,
      audience: "public",
      hidden_at: "2026-11-27T11:00:00Z",
      deleted_at: null,
      moderation_status: "approved",
    };
    const weak = report({ id: "22222222-2222-4222-8222-222222222222" });
    h.answers.user_reports = [
      { data: [weak], error: null },
      // the report a moderator acted on (Remove content), read whatever the queue's filter
      { data: [{ id: "11111111-1111-4111-8111-111111111111", post_id: "post-1" }], error: null },
    ];
    h.answers.posts = [{ data: [hiddenPost], error: null }];
    const out = await listReports({ data: { status: "new", subjectType: "post" } });
    const acted = h.calls.filter((c) => c.table === "user_reports")[1];
    expect(acted.ops).toEqual([
      ["select", "id, post_id"],
      ["in", "post_id", ["post-1"]],
      ["in", "status", ["resolved", "actioned"]],
    ]);
    expect(out.reports[0].post?.restoreKeepsHidden).toBe(
      "another report about this post was acted on",
    );
  });

  it("tells a moderator before Restore when the post was hidden again after this report hid it", async () => {
    const mine = report({
      status: "resolved",
      resolution_notes: "Post hidden — abuse",
      reviewed_at: T_MINE,
    });
    const post = (hidden_at: string | null) => ({
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
    h.answers.user_reports = [
      { data: [mine], error: null },
      { data: [{ id: mine.id, post_id: "post-1" }], error: null },
    ];
    h.answers.posts = [{ data: [post(T_LATER)], error: null }];
    const later = await listReports({ data: { status: "all", subjectType: "post" } });
    expect(later.reports[0].post?.restoreKeepsHidden).toBe(RESTORE_KEEPS_HIDDEN.hiddenSince);

    h.answers.user_reports = [
      { data: [mine], error: null },
      { data: [{ id: mine.id, post_id: "post-1" }], error: null },
    ];
    h.answers.posts = [{ data: [post(T_MINE)], error: null }];
    const own = await listReports({ data: { status: "all", subjectType: "post" } });
    expect(own.reports[0].post).toMatchObject({ hidden: true, restoreKeepsHidden: null });
  });

  it("keeps a report whose post was deleted for good, without the post", async () => {
    h.answers.user_reports = [{ data: [report({ post_id: null })], error: null }];
    const out = await listReports({ data: { status: "new", subjectType: "all" } });
    expect(h.calls.some((c) => c.table === "posts")).toBe(false);
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

describe("postRestoreBlocker and the text fingerprint", () => {
  const own = {
    resolutionNotes: "Post hidden — abuse",
    reviewedAt: T_MINE,
    hiddenAt: T_MINE,
    otherClosedReports: 0,
  };

  it("lets Restore unhide only this report's own hide, while no other report was acted on", () => {
    expect(postRestoreBlocker(own)).toBeNull();
    expect(postRestoreBlocker({ ...own, resolutionNotes: "Post hidden" })).toBeNull();
    expect(postRestoreBlocker({ ...own, otherClosedReports: 1 })).toBe(
      RESTORE_KEEPS_HIDDEN.otherReport,
    );
    expect(postRestoreBlocker({ ...own, resolutionNotes: "Warning issued" })).toBe(
      RESTORE_KEEPS_HIDDEN.notThisReport,
    );
    expect(postRestoreBlocker({ ...own, resolutionNotes: null })).toBe(
      RESTORE_KEEPS_HIDDEN.notThisReport,
    );
  });

  it("keeps a post hidden whose hidden_at is not exactly this report's reviewed_at", () => {
    // a later hide (superadmin, another moderator)
    expect(postRestoreBlocker({ ...own, hiddenAt: T_LATER })).toBe(
      RESTORE_KEEPS_HIDDEN.hiddenSince,
    );
    // this report changed after its Remove content (a status change, a second action): fail safe
    expect(postRestoreBlocker({ ...own, reviewedAt: T_LATER })).toBe(
      RESTORE_KEEPS_HIDDEN.hiddenSince,
    );
    // a microsecond apart is not the same `now`
    expect(postRestoreBlocker({ ...own, hiddenAt: "2026-11-27T11:00:00.123001+00:00" })).toBe(
      RESTORE_KEEPS_HIDDEN.hiddenSince,
    );
    expect(postRestoreBlocker({ ...own, reviewedAt: null })).toBe(RESTORE_KEEPS_HIDDEN.hiddenSince);
    expect(postRestoreBlocker({ ...own, hiddenAt: "not a time", reviewedAt: "not a time" })).toBe(
      RESTORE_KEEPS_HIDDEN.hiddenSince,
    );
    // the same instant however PostgREST or toISOString spells it
    expect(postRestoreBlocker({ ...own, reviewedAt: "2026-11-27T11:00:00.123Z" })).toBeNull();
  });

  it("says nothing before Restore about a post that is not hidden", () => {
    expect(restoreKeepsHidden({ ...own, hiddenAt: null, resolutionNotes: null })).toBeNull();
    expect(restoreKeepsHidden({ ...own, hiddenAt: T_LATER })).toBe(
      RESTORE_KEEPS_HIDDEN.hiddenSince,
    );
  });

  it("says notThisReport only in words that are true after a second action or a refused Restore", () => {
    // this report hid the post, then a Warn (or a refused Restore) rewrote its notes: it did hide it once
    expect(RESTORE_KEEPS_HIDDEN.notThisReport).toBe("this report's latest action did not hide it");
    expect(RESTORE_KEEPS_ACCOUNT.notThisReport).toBe(
      "this report's latest action did not suspend or ban it",
    );
  });

  it("lifts the author's suspension or ban only for this report's own, unchanged action", () => {
    const ownBan = {
      resolutionNotes: "Account banned — abuse",
      reviewedAt: T_MINE,
      suspendedAt: T_MINE,
      otherAccountReports: 0,
    };
    expect(accountRestoreBlocker(ownBan)).toBeNull();
    expect(accountRestoreBlocker({ ...ownBan, resolutionNotes: "Account suspended" })).toBeNull();
    expect(
      accountRestoreBlocker({ ...ownBan, suspendedAt: "2026-11-27T11:00:00.123Z" }),
    ).toBeNull();
    expect(accountRestoreBlocker({ ...ownBan, otherAccountReports: 1 })).toBe(
      RESTORE_KEEPS_ACCOUNT.otherReport,
    );
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

  it("writes a summary that says what was undone and kept, and never claims an action", () => {
    expect(restoreSummary(["ban lifted", "post unhidden"], [])).toBe("Ban lifted, post unhidden.");
    expect(restoreSummary([], [])).toBe("Nothing to undo.");
    const kept = keptPostSentence(RESTORE_KEEPS_HIDDEN.otherReport);
    expect(kept).toBe(
      "The post stays hidden: another report about this post was acted on. A superadmin unhides it on /superadmin, Content, Network posts.",
    );
    expect(restoreSummary([], [kept])).toBe(`Nothing undone. ${kept}`);
    expect(keptAccountSentence("suspended", "x")).toBe(
      "The account stays suspended: x. A superadmin lifts the suspension on /superadmin, Users & profiles, Restore account.",
    );
    expect(keptAccountSentence("warned", "x")).toMatch(/^The account stays suspended: x\./);
    expect(keptAccountSentence("banned", "x")).toMatch(/^The account stays banned: x\./);
    for (const s of [
      restoreSummary(["post unhidden"], []),
      restoreSummary(["warning cleared"], [kept]),
      restoreSummary([], [kept]),
    ]) {
      expect(s).not.toMatch(/^(Post hidden|Account suspended|Account banned)/);
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
  const act = (action: string) =>
    applyModerationAction({
      data: { reportId: "11111111-1111-4111-8111-111111111111", action, reason: "abuse" },
    });

  it("Remove content hides the post, resolves the report and audits the post", async () => {
    h.answers.user_reports = [{ data: [report()], error: null }];
    const out = await act("remove_content");
    expect(out.summary).toBe("Post hidden");
    const [hide] = updatesOf("posts");
    expect(hide.where).toEqual(["id", "post-1"]);
    expect(Object.keys(hide.set as object)).toEqual(["hidden_at"]);
    expect((hide.set as { hidden_at: unknown }).hidden_at).toEqual(expect.any(String));
    expect(updatesOf("user_reports")[0].set).toMatchObject({ status: "resolved" });
    expect(h.audit.mock.calls[0][2]).toMatchObject({
      action: "content.remove",
      targetType: "post",
      targetId: "post-1",
    });
  });

  const hiddenAt = (at: string | null) => ({
    data: [{ id: "post-1", hidden_at: at }],
    error: null,
  });
  /** The author's profile as Restore reads it. */
  const author = (suspended_at: string | null, moderation_state: string) => ({
    data: [{ id: "author", suspended_at, moderation_state }],
    error: null,
  });
  const ACTIVE = author(null, "active");
  /** This report, after its own Remove content: its notes, and reviewed_at = the hide's `now`. */
  const mine = (over: Record<string, unknown> = {}) =>
    report({
      status: "resolved",
      resolution_notes: "Post hidden — abuse",
      reviewed_at: T_MINE,
      ...over,
    });
  const OTHER_ID = "22222222-2222-4222-8222-222222222222";
  /** Every write to a table, with all its filters. */
  const writesTo = (table: string) =>
    h.calls.filter((c) => c.table === table && c.ops.some((o) => o[0] === "update"));
  const postWrites = () => writesTo("posts");
  const anyWrites = () => h.calls.filter((c) => c.ops.some((o) => o[0] === "update"));
  /** Restore's answers for user_reports: the report, then the post's acted-on reports, then the author's. */
  const reports = (r: unknown, postActed: unknown[], accountActed: unknown[] = []) => [
    { data: [r], error: null },
    { data: postActed, error: null },
    { data: accountActed, error: null },
  ];
  const nothingUndone = (...kept: string[]) => ["Nothing undone.", ...kept].join(" ");

  it("Remove content writes one timestamp to the post's hidden_at and the report's reviewed_at", async () => {
    h.answers.user_reports = [{ data: [report()], error: null }];
    await act("remove_content");
    const hide = updatesOf("posts")[0].set as { hidden_at: string };
    const review = updatesOf("user_reports")[0].set as { reviewed_at: string };
    expect(review.reviewed_at).toBe(hide.hidden_at);
  });

  it("Restore unhides the post when this report's own Remove content hid it", async () => {
    const r = mine();
    h.answers.user_reports = reports(r, [{ id: r.id }]);
    h.answers.profiles = [ACTIVE];
    h.answers.posts = [hiddenAt(T_MINE)];
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
    expect(updatesOf("user_reports").at(-1)?.set).toMatchObject({ status: "dismissed" });
    // an account nobody restricted is not written
    expect(writesTo("profiles")).toEqual([]);
  });

  it("Restore leaves a post hidden that a superadmin hid after this report's Remove content", async () => {
    const r = mine();
    h.answers.user_reports = reports(r, [{ id: r.id }]);
    h.answers.posts = [hiddenAt(T_LATER)];
    const out = await act("restore");
    expect(postWrites()).toEqual([]);
    const summary = nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.hiddenSince));
    expect(out.summary).toBe(summary);
    expect(h.audit.mock.calls[0][2]).toMatchObject({ after: { summary } });
  });

  it("Restore leaves a post hidden that another moderator hid later through another report", async () => {
    const r = mine();
    h.answers.user_reports = reports(r, [{ id: r.id }, { id: OTHER_ID }]);
    h.answers.posts = [hiddenAt(T_LATER)];
    const out = await act("restore");
    expect(postWrites()).toEqual([]);
    expect(out.summary).toBe(nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.otherReport)));
  });

  it("Restore leaves the post hidden while another report about it is resolved, even with this report's own hide", async () => {
    const r = mine();
    h.answers.user_reports = reports(r, [{ id: r.id }, { id: OTHER_ID }]);
    h.answers.posts = [hiddenAt(T_MINE)];
    const out = await act("restore");
    expect(postWrites()).toEqual([]);
    expect(out.summary).toBe(nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.otherReport)));
    const acted = h.calls.filter((c) => c.table === "user_reports")[1];
    expect(acted.ops).toEqual([
      ["select", "id"],
      ["eq", "post_id", "post-1"],
      ["in", "status", ["resolved", "actioned"]],
    ]);
  });

  it("Restore on a weak second report leaves a post another report took down hidden", async () => {
    const weak = report({ id: OTHER_ID });
    h.answers.user_reports = reports(weak, [{ id: "11111111-1111-4111-8111-111111111111" }]);
    h.answers.posts = [hiddenAt(T_MINE)];
    const out = await act("restore");
    expect(postWrites()).toEqual([]);
    expect(out.summary).toBe(nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.otherReport)));
  });

  it("Restore leaves a post hidden that this report's notes do not say it hid, even at the same instant", async () => {
    for (const notes of [null, "Warning issued — abuse", "Post unhidden."]) {
      h.calls = [];
      const r = mine({ resolution_notes: notes });
      h.answers.user_reports = reports(r, [{ id: r.id }]);
      h.answers.posts = [hiddenAt(T_MINE)];
      const out = await act("restore");
      expect(postWrites()).toEqual([]);
      expect(out.summary).toBe(nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.notThisReport)));
    }
  });

  it("Restore leaves the post hidden once this report's reviewed_at changed after its Remove content", async () => {
    // a status change or a second action on the report re-stamps reviewed_at: the rule fails safe
    const r = mine({ status: "escalated", reviewed_at: T_LATER });
    h.answers.user_reports = reports(r, []);
    h.answers.posts = [hiddenAt(T_MINE)];
    const out = await act("restore");
    expect(postWrites()).toEqual([]);
    expect(out.summary).toBe(nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.hiddenSince)));
  });

  it("Restore keeps a hide made between its read and its write", async () => {
    const r = mine();
    h.answers.user_reports = reports(r, [{ id: r.id }]);
    // the read sees this report's hide; the guarded unhide then matches no row
    h.answers.posts = [hiddenAt(T_MINE), { data: [], error: null }];
    const out = await act("restore");
    expect(postWrites()).toHaveLength(1);
    expect(out.summary).toBe(nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.hiddenSince)));
  });

  it("Restore says so when unhiding the post failed", async () => {
    const r = mine();
    h.answers.user_reports = reports(r, [{ id: r.id }]);
    h.answers.posts = [hiddenAt(T_MINE), { data: null, error: { message: "boom" } }];
    const out = await act("restore");
    expect(out.summary).toBe(nothingUndone(keptPostSentence("unhiding it failed")));
    expect(updatesOf("user_reports").at(-1)?.set).toMatchObject({ status: "dismissed" });
  });

  it("Restore writes nothing to a post that is already visible", async () => {
    const r = mine();
    h.answers.user_reports = reports(r, [{ id: r.id }]);
    h.answers.profiles = [ACTIVE];
    h.answers.posts = [hiddenAt(null)];
    const out = await act("restore");
    expect(out.summary).toBe("Nothing to undo.");
    expect(postWrites()).toEqual([]);
    expect(writesTo("profiles")).toEqual([]);
  });

  describe("Restore and the author's account (only this report's own Suspend or Ban is lifted)", () => {
    /** This report, after its own Ban: notes, and reviewed_at = suspended_at = the ban's `now`. */
    const banned = (over: Record<string, unknown> = {}) =>
      mine({ resolution_notes: "Account banned — abuse", ...over });
    const keptBan = (why: string) => keptAccountSentence("banned", why);

    it("lifts this report's own ban, only while suspended_at still holds it", async () => {
      const r = banned();
      h.answers.user_reports = reports(
        r,
        [{ id: r.id }],
        [{ id: r.id, resolution_notes: "Account banned — abuse" }],
      );
      h.answers.profiles = [author(T_MINE, "banned"), { data: [{ id: "author" }], error: null }];
      h.answers.posts = [hiddenAt(null)];
      const out = await act("restore");
      expect(out.summary).toBe("Ban lifted.");
      expect(writesTo("profiles").map((c) => c.ops)).toEqual([
        [
          ["update", { suspended_at: null, suspended_reason: null, moderation_state: "active" }],
          ["eq", "id", "author"],
          ["eq", "suspended_at", T_MINE],
          ["select", "id"],
        ],
      ]);
      const accountActed = h.calls.filter((c) => c.table === "user_reports")[2];
      expect(accountActed.ops).toEqual([
        ["select", "id, resolution_notes"],
        ["eq", "reported_id", "author"],
        ["in", "status", ["resolved", "actioned"]],
        ["like", "resolution_notes", "Account %"],
      ]);
    });

    it("lifts this report's own suspension", async () => {
      const r = banned({ resolution_notes: "Account suspended — abuse" });
      h.answers.user_reports = reports(r, []);
      h.answers.profiles = [
        author("2026-11-27T11:00:00.123Z", "suspended"),
        { data: [{ id: "author" }], error: null },
      ];
      const out = await act("restore");
      expect(out.summary).toBe("Suspension lifted.");
      expect(writesTo("profiles")).toHaveLength(1);
    });

    it("never lifts a ban this report did not make, even while this report's own hide is undone", async () => {
      // this report hid the post; the author was banned by someone else (a superadmin, another moderator)
      const r = mine();
      h.answers.user_reports = reports(r, [{ id: r.id }]);
      h.answers.profiles = [author(T_LATER, "banned")];
      h.answers.posts = [hiddenAt(T_MINE)];
      const out = await act("restore");
      expect(writesTo("profiles")).toEqual([]);
      expect(postWrites()).toHaveLength(1);
      expect(out.summary).toBe(`Post unhidden. ${keptBan(RESTORE_KEEPS_ACCOUNT.notThisReport)}`);
    });

    it("keeps this report's own ban while another report about the author banned or suspended them", async () => {
      const r = banned();
      h.answers.user_reports = reports(
        r,
        [],
        [
          { id: r.id, resolution_notes: "Account banned — abuse" },
          { id: OTHER_ID, resolution_notes: "Account suspended — spam" },
        ],
      );
      h.answers.profiles = [author(T_MINE, "banned")];
      const out = await act("restore");
      expect(writesTo("profiles")).toEqual([]);
      expect(out.summary).toBe(nothingUndone(keptBan(RESTORE_KEEPS_ACCOUNT.otherReport)));
    });

    it("does not count another report whose notes claim no suspension or ban", async () => {
      const r = banned();
      h.answers.user_reports = reports(
        r,
        [],
        [{ id: OTHER_ID, resolution_notes: "Accountability note" }],
      );
      h.answers.profiles = [author(T_MINE, "banned"), { data: [{ id: "author" }], error: null }];
      const out = await act("restore");
      expect(out.summary).toBe("Ban lifted.");
    });

    it("keeps a ban made or changed after this report's own (a later superadmin suspension, reviewed_at changed)", async () => {
      for (const [suspendedAt, reviewedAt] of [
        [T_LATER, T_MINE],
        [T_MINE, T_LATER],
        ["2026-11-27T11:00:00.123001+00:00", T_MINE],
      ]) {
        h.calls = [];
        h.answers.user_reports = reports(banned({ reviewed_at: reviewedAt }), []);
        h.answers.profiles = [author(suspendedAt, "banned")];
        const out = await act("restore");
        expect(writesTo("profiles")).toEqual([]);
        expect(out.summary).toBe(nothingUndone(keptBan(RESTORE_KEEPS_ACCOUNT.changedSince)));
      }
    });

    it("keeps a ban whose suspension a superadmin lifted (still 'banned', suspended_at cleared)", async () => {
      h.answers.user_reports = reports(banned(), []);
      h.answers.profiles = [author(null, "banned")];
      const out = await act("restore");
      expect(writesTo("profiles")).toEqual([]);
      expect(out.summary).toBe(nothingUndone(keptBan(RESTORE_KEEPS_ACCOUNT.changedSince)));
    });

    it("keeps a ban or lift made between its read and its write", async () => {
      h.answers.user_reports = reports(banned(), []);
      h.answers.profiles = [author(T_MINE, "banned"), { data: [], error: null }];
      const out = await act("restore");
      expect(writesTo("profiles")).toHaveLength(1);
      expect(out.summary).toBe(nothingUndone(keptBan(RESTORE_KEEPS_ACCOUNT.changedSince)));
    });

    it("says so when lifting the ban failed", async () => {
      h.answers.user_reports = reports(banned(), []);
      h.answers.profiles = [author(T_MINE, "banned"), { data: null, error: { message: "boom" } }];
      const out = await act("restore");
      expect(out.summary).toBe(nothingUndone(keptBan("lifting it failed")));
    });

    it("still clears a warning, only while the author is still just warned", async () => {
      h.answers.user_reports = reports(mine({ resolution_notes: "Warning issued — abuse" }), []);
      h.answers.profiles = [author(null, "warned"), { data: [{ id: "author" }], error: null }];
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

    it("does not lift the author by id on a post report whose post was deleted for good", async () => {
      h.answers.user_reports = reports(mine({ post_id: null }), []);
      h.answers.profiles = [author(T_LATER, "banned")];
      const out = await act("restore");
      expect(h.calls.some((c) => c.table === "posts")).toBe(false);
      expect(writesTo("profiles")).toEqual([]);
      expect(out.summary).toBe(nothingUndone(keptBan(RESTORE_KEEPS_ACCOUNT.notThisReport)));
      expect(updatesOf("user_reports").at(-1)?.set).toMatchObject({ status: "dismissed" });
    });
  });

  describe("Restore changes nothing when a read fails (fail closed)", () => {
    const READS = [
      ["the post", "posts", 0],
      ["the post's acted-on reports", "user_reports", 1],
      ["the author's profile", "profiles", 0],
      ["the author's acted-on reports", "user_reports", 2],
    ] as const;
    for (const [what, table, index] of READS) {
      it(`when reading ${what} fails`, async () => {
        const r = mine();
        // R2 about the same post was resolved without a re-hide; this report's own hide is still in place
        h.answers.user_reports = reports(r, [{ id: r.id }, { id: OTHER_ID }]);
        h.answers.profiles = [author(T_LATER, "banned")];
        h.answers.posts = [hiddenAt(T_MINE)];
        const failed = { data: null, error: { message: "timeout" } };
        if (table === "user_reports") h.answers.user_reports[index] = failed;
        else h.answers[table] = [failed];
        await expect(act("restore")).rejects.toThrow(RESTORE_READ_FAILED);
        expect(anyWrites()).toEqual([]);
        expect(h.audit).not.toHaveBeenCalled();
      });
    }
  });

  describe("what a Restore after a second action or a refused Restore says (always true)", () => {
    it("Remove content then Warn on the same report: the post stays hidden, and the reason says why truly", async () => {
      const r = mine({ resolution_notes: "Warning issued — abuse", reviewed_at: T_LATER });
      h.answers.user_reports = reports(r, [{ id: r.id }]);
      h.answers.profiles = [author(null, "warned"), { data: [{ id: "author" }], error: null }];
      h.answers.posts = [hiddenAt(T_MINE)];
      const out = await act("restore");
      expect(postWrites()).toEqual([]);
      expect(out.summary).toBe(
        `Warning cleared. ${keptPostSentence(RESTORE_KEEPS_HIDDEN.notThisReport)}`,
      );
      expect(out.summary).not.toMatch(/this report did not hide it/);
    });

    it("Remove content then Ban on the same report: the ban is lifted, the post stays hidden", async () => {
      const r = mine({ resolution_notes: "Account banned — abuse", reviewed_at: T_LATER });
      h.answers.user_reports = reports(r, [{ id: r.id }]);
      h.answers.profiles = [author(T_LATER, "banned"), { data: [{ id: "author" }], error: null }];
      h.answers.posts = [hiddenAt(T_MINE)];
      const out = await act("restore");
      expect(postWrites()).toEqual([]);
      expect(out.summary).toBe(
        `Ban lifted. ${keptPostSentence(RESTORE_KEEPS_HIDDEN.notThisReport)}`,
      );
    });

    it("a refused Restore writes notes that claim no action, so a later Restore undoes nothing more", async () => {
      const r = mine();
      h.answers.user_reports = reports(r, [{ id: r.id }, { id: OTHER_ID }]);
      h.answers.profiles = [ACTIVE];
      h.answers.posts = [hiddenAt(T_MINE)];
      await act("restore");
      const refused = updatesOf("user_reports").at(-1)?.set as {
        resolution_notes: string;
        reviewed_at: string;
        status: string;
      };
      expect(refused.status).toBe("dismissed");
      expect(refused.resolution_notes).toBe(
        `${nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.otherReport))} — abuse`,
      );
      expect(refused.resolution_notes).not.toMatch(
        /^(Post hidden|Account suspended|Account banned)/,
      );

      // the other report is dismissed later; Restore on this report again
      h.calls = [];
      h.answers.user_reports = reports(
        mine({
          status: "dismissed",
          resolution_notes: refused.resolution_notes,
          reviewed_at: refused.reviewed_at,
        }),
        [],
      );
      h.answers.profiles = [ACTIVE];
      h.answers.posts = [hiddenAt(T_MINE)];
      const again = await act("restore");
      expect(postWrites()).toEqual([]);
      expect(again.summary).toBe(
        nothingUndone(keptPostSentence(RESTORE_KEEPS_HIDDEN.notThisReport)),
      );
    });
  });

  it("Remove content refuses a report whose post is gone", async () => {
    h.answers.user_reports = [{ data: [report({ post_id: null })], error: null }];
    await expect(act("remove_content")).rejects.toThrow(
      "This report has no removable content attached",
    );
    expect(updatesOf("posts")).toEqual([]);
  });

  it("Warn touches the author, never the post", async () => {
    h.answers.user_reports = [{ data: [report()], error: null }];
    await act("warn");
    expect(updatesOf("posts")).toEqual([]);
    expect(updatesOf("profiles")[0].where).toEqual(["id", "author"]);
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

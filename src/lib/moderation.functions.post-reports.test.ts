import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Post reports in the moderation queue (20261205100000): a moderator sees the reported post and its context, and the
 * existing Remove content and Restore actions hide and unhide it as they do a reported game or reel. user_reports.post_id
 * is read only where it exists, so the queue keeps working before the migration is applied and after its rollback.
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
      for (const m of ["select", "eq", "in", "order", "limit", "update", "insert"]) {
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

import {
  applyModerationAction,
  isMissingPostIdColumn,
  listReports,
} from "@/lib/moderation.functions";

const MISSING_POST_ID = {
  code: "42703",
  message: "column user_reports.post_id does not exist",
};

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
    expect(selectsOf("user_reports")).toHaveLength(1);
    expect(selectsOf("user_reports")[0]).toMatch(/, post_id$/);
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
      },
    });
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

describe("isMissingPostIdColumn", () => {
  it("is true only for a missing post_id column", () => {
    expect(isMissingPostIdColumn(MISSING_POST_ID)).toBe(true);
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

  it("Restore unhides the post, as it does a game or reel", async () => {
    h.answers.user_reports = [{ data: [report()], error: null }];
    await act("restore");
    expect(updatesOf("posts")).toEqual([{ set: { hidden_at: null }, where: ["id", "post-1"] }]);
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

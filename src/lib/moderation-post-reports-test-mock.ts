/**
 * Test helper for the post report tests (not a test file itself): a scripted stand-in for the service-role client
 * (each table answers in turn, the last answer repeating, and every call's query-builder steps are recorded), a
 * server-function stand-in, and the rows and moments the tests use. moderation.functions.post-reports.test.ts and
 * moderation.functions.post-restore-state.test.ts mock @tanstack/react-start, @/lib/moderation.server,
 * @/lib/audit-log.server and @/integrations/supabase/client.server with these.
 */
import { vi } from "vitest";

// A server function is its handler for these tests: validate the input, then run it.
export const reactStart = {
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
};

export type Result = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  count?: number | null;
};
type Call = { table: string; ops: [string, ...unknown[]][] };

export const h = {
  calls: [] as Call[],
  /** Answers per table, in order; the last one repeats. */
  answers: {} as Record<string, Result[]>,
  assertModerator: vi.fn(async (..._args: unknown[]) => undefined),
  audit: vi.fn(async (..._args: unknown[]) => undefined),
};

/** Everything empty, nothing called: for each test's beforeEach. */
export function resetMock() {
  h.calls = [];
  h.answers = {};
  h.assertModerator.mockClear();
  h.audit.mockClear();
}

const answer = (table: string): Result => {
  const list = h.answers[table] ?? [];
  return (list.length > 1 ? list.shift() : list[0]) ?? { data: [], error: null };
};

export const supabaseAdmin = {
  from(table: string) {
    const call: Call = { table, ops: [] };
    h.calls.push(call);
    const q: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "neq",
      "gt",
      "is",
      "in",
      "like",
      "order",
      "limit",
      "update",
      "insert",
    ]) {
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
    // A read with { count: "exact" } is told how many rows it matched: all it got, unless the answer says more.
    const counted = (r: Result): Result => {
      const select = call.ops.find((o) => o[0] === "select");
      const wantsCount = (select?.[2] as { count?: string } | undefined)?.count === "exact";
      if (!wantsCount || "count" in r) return r;
      return { ...r, count: Array.isArray(r.data) ? r.data.length : r.data ? 1 : 0 };
    };
    q.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(counted(answer(table))).then(resolve, reject);
    return q;
  },
};

/** An earlier moment: a superadmin's hide or suspension, or another report's action, before this report's. */
export const T_EARLIER = "2026-11-27T09:00:00.789+00:00";
/** This report's action: the value it wrote and its reviewed_at as PostgREST returns them, from one `now`. */
export const T_MINE = "2026-11-27T11:00:00.123+00:00";
/** A later moment: a superadmin's or another moderator's hide, or a later change to this report. */
export const T_LATER = "2026-11-27T12:30:00.456+00:00";

export const MINE_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_ID = "22222222-2222-4222-8222-222222222222";

export const report = (over: Record<string, unknown> = {}) => ({
  id: MINE_ID,
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
  // md5("Tryouts Sunday"): the post's text when it was reported
  post_body_md5: "a9a75c4fb54b19823148e4171208b3e1",
  ...over,
});

/** An admin_audit_log row of a report's action, as Restore and the card read it back. */
export const auditRow = (
  reportId: string,
  action: string,
  after: Record<string, unknown> = {},
  createdAt = T_MINE,
) => ({
  action,
  before: { reportId, reportReason: "harassment" },
  after: { summary: "x", reportedUserId: "author", ...after },
  created_at: createdAt,
});

/** The audit entry a post report's Suspend or Ban writes on an account nobody had restricted (fresh). */
export const freshRestrict = (reportId: string, at: string, action = "user.ban") =>
  auditRow(
    reportId,
    action,
    {
      suspendedAt: at,
      moderationState: action === "user.ban" ? "banned" : "suspended",
      fresh: true,
      actedAt: at,
    },
    at,
  );

/** A paged list read's last two steps (moderation.functions.ts readAllRows): id order, one page of rows. */
export const PAGE = [
  ["order", "id", { ascending: true }],
  ["limit", 1000],
];
export const COUNT = { count: "exact" };

export const selectsOf = (table: string) =>
  h.calls
    .filter((c) => c.table === table)
    .flatMap((c) => c.ops.filter((o) => o[0] === "select").map((o) => String(o[1])));
export const updatesOf = (table: string) =>
  h.calls
    .filter((c) => c.table === table)
    .flatMap((c) => {
      const update = c.ops.find((o) => o[0] === "update");
      const eq = c.ops.find((o) => o[0] === "eq");
      return update ? [{ set: update[1], where: eq?.slice(1) }] : [];
    });

/** Every write to a table, with all its filters. */
export const writesTo = (table: string) =>
  h.calls.filter((c) => c.table === table && c.ops.some((o) => o[0] === "update"));
export const anyWrites = () => h.calls.filter((c) => c.ops.some((o) => o[0] === "update"));
export const ok = (rows: unknown[] = [{ id: "x" }]): Result => ({ data: rows, error: null });
export const NONE = ok([]);
export const BOOM: Result = { data: null, error: { message: "boom" } };
export const auditCall = (i = 0) => h.audit.mock.calls[i][2] as Record<string, unknown>;

/** The author's profile as Restore reads it. */
export const author = (suspended_at: string | null, moderation_state: string) =>
  ok([
    {
      id: "author",
      suspended_at,
      suspended_reason: suspended_at ? "abuse" : null,
      moderation_state,
    },
  ]);
/** This report, after its own Remove content: its notes, and reviewed_at = the hide's `now`. */
export const mine = (over: Record<string, unknown> = {}) =>
  report({
    status: "resolved",
    resolution_notes: "Post hidden — abuse",
    reviewed_at: T_MINE,
    ...over,
  });
/** This report, after its own Ban: notes, and reviewed_at = suspended_at = the ban's `now`. */
export const banned = (over: Record<string, unknown> = {}) =>
  mine({ resolution_notes: "Account banned — abuse", ...over });
/** Another report as Restore reads it. */
export const row = (
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
/**
 * Restore's answers for user_reports: the report, the post's reports (not dismissed), the author's reports (not
 * dismissed), then the guarded update of the report.
 */
export const reports = (
  r: { id: string },
  postRows: unknown[] = [],
  accountRows: unknown[] = [],
  update: Result = ok([{ id: r.id }]),
) => [ok([r]), ok(postRows), ok(accountRows), update];
export const hiddenAt = (at: string | null) => ok([{ id: "post-1", hidden_at: at }]);

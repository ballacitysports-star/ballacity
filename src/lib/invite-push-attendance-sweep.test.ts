import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * WP 5.4 and WP 5.6: the 5-minute sweep pushes invite notifications once and prompts hosts to mark attendance once.
 * The real deliverPush runs (quiet hours, the OneSignal key, the delivery log); only its service-role client, the
 * curfew lookup and the network are replaced.
 */
const { db, curfewGateFor } = vi.hoisted(() => ({
  db: { inserts: [] as { table: string; row: Record<string, unknown> }[] },
  curfewGateFor: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        db.inserts.push({ table, row });
        return { data: null, error: null };
      },
    }),
  },
}));
vi.mock("@/lib/push-curfew.server", () => ({ curfewGateFor }));
/**
 * The real deliverPush, unless a test stands in for it (`pushStandIn.fn`). The timing tests below start four pushes in the
 * same tick, and vitest 4 does not apply vi.mock to several dynamic imports of a mocked module started in the same tick
 * (deliverPush imports the service client and the curfew gate that way): those tests use a stand-in that records each push.
 */
const { pushStandIn } = vi.hoisted(() => ({
  pushStandIn: { fn: null as null | ((p: { userId: string }) => Promise<unknown>) },
}));
vi.mock("@/lib/push.server", async (importActual) => {
  const actual = await importActual<typeof import("./push.server")>();
  return {
    ...actual,
    deliverPush: (p: Parameters<typeof actual.deliverPush>[0]) =>
      pushStandIn.fn ? pushStandIn.fn(p) : actual.deliverPush(p),
  };
});

import {
  ATTENDANCE_PROMPT_TYPE,
  attendancePromptLink,
  attendancePromptText,
  inviteLinkExpiry,
  promptHostsForAttendance,
  PUSH_CONCURRENCY,
  pushInviteNotifications,
  runScheduledSweeps,
  type ReminderAdmin,
} from "./game-reminders.server";

const NOW = Date.parse("2026-11-29T20:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ id: "os-1", recipients: 1 }), { status: 200 }),
);
/** What reached OneSignal: one entry per push actually sent. */
type SentPush = {
  include_aliases: { external_id: string[] };
  headings: { en: string };
  contents: { en: string };
  url?: string;
};
const sent = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as SentPush);
const held = () => db.inserts.filter((i) => i.table === "scheduled_notifications");
const logged = () => db.inserts.filter((i) => i.table === "notification_delivery_log");

beforeEach(() => {
  pushStandIn.fn = null;
  db.inserts = [];
  curfewGateFor.mockReset();
  curfewGateFor.mockResolvedValue({ action: "send" });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ONESIGNAL_REST_API_KEY", "test-key");
  vi.stubEnv("PUBLIC_SITE_URL", "https://ballacity.test");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Row = Record<string, unknown>;

/**
 * An in-memory PostgREST stand-in: every table is a list of rows, a query runs when awaited, and an update applies its
 * filters at that moment, as a single SQL UPDATE does (so two sweeps at once cannot both take a row).
 * Like PostgREST on hosted Supabase, a read returns at most `maxRows` rows (default 1000) and, without an order, returns
 * rows in storage order (here: the order they were added).
 */
function fakeDb(
  tables: Record<string, Row[]>,
  opts: {
    failInsert?: boolean;
    failPrefs?: boolean;
    failPrefsFrom?: number;
    maxRows?: number;
    /** An rpc that answers with an error. */
    failRpc?: string;
  } = {},
) {
  const maxRows = opts.maxRows ?? 1000;
  let prefsReads = 0;
  const reads: string[] = [];
  let nextId = 1;
  const admin: ReminderAdmin = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: ((r: Row) => boolean)[] = [];
      let mode: "read" | "update" | "insert" = "read";
      let patch: Row = {};
      let picked: string[] | null = null;
      let limit = Infinity;
      let offset = 0;
      const orderBy: string[] = [];
      const run = () => {
        if (mode === "insert") {
          if (opts.failInsert) return { data: null, error: { message: "boom" } };
          const row = { id: `n${nextId++}`, created_at: new Date(NOW).toISOString(), ...patch };
          rows.push(row);
          return { data: [{ id: row.id }], error: null };
        }
        if (mode === "read") reads.push(table);
        if (mode === "read" && table === "notification_preferences") {
          prefsReads += 1;
          if (opts.failPrefs || (opts.failPrefsFrom != null && prefsReads >= opts.failPrefsFrom)) {
            return { data: null, error: { message: "down" } };
          }
        }
        let hit = rows.filter((r) => filters.every((f) => f(r)));
        if (mode === "update") {
          for (const r of hit) Object.assign(r, patch);
          return { data: hit.map((r) => ({ id: r.id })), error: null };
        }
        if (orderBy.length > 0) {
          hit = [...hit].sort((a, b) => {
            for (const key of orderBy) {
              const c = String(a[key]).localeCompare(String(b[key]));
              if (c !== 0) return c;
            }
            return 0;
          });
        }
        hit = hit.slice(offset, offset + Math.min(limit, maxRows));
        const cols = picked;
        return {
          data: hit.map((r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c] ?? null])) : r)),
          error: null,
        };
      };
      const q: Record<string, unknown> = {
        select: (c: string) => {
          if (mode === "read") picked = c.split(",").map((s) => s.trim());
          return q;
        },
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
        is: (c: string, v: null) => (filters.push((r) => (r[c] ?? null) === v), q),
        gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), q),
        lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), q),
        lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), q),
        neq: (c: string, v: unknown) => (filters.push((r) => r[c] != null && r[c] !== v), q),
        order: (c: string) => (orderBy.push(c), q),
        limit: (n: number) => ((limit = n), q),
        range: (from: number, to: number) => ((offset = from), (limit = to - from + 1), q),
        or: (f: string) => (filters.push(orFilter(f)), q),
        update: (p: Row) => ((mode = "update"), (patch = p), q),
        insert: (p: Row) => ((mode = "insert"), (patch = p), q),
        delete: () => q,
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve().then(run).then(ok, ko),
      };
      return q as never;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      reads.push(`rpc:${fn}`);
      if (opts.failRpc === fn) return { data: null, error: { message: `${fn} down` } };
      if (fn === "invite_pushes_allowed")
        return { data: invitePushesAllowed(tables, args), error: null };
      if (fn === "send_attendance_prompt") {
        // One transaction: the stamp and the notice together, or neither.
        if (opts.failInsert) return { data: null, error: { message: "boom" } };
        const g = (tables.hosted_games ?? []).find((r) => r.id === args._game);
        const roster = (tables.game_participants ?? []).filter((p) => p.game_id === args._game);
        if (
          !g ||
          g.attendance_prompted_at != null ||
          g.cancelled_at != null ||
          g.status === "cancelled" ||
          !roster.some((p) => p.user_id !== g.host_id) ||
          roster.some((p) => p.attended != null || p.attendance_marked_at != null)
        ) {
          return { data: null, error: null };
        }
        g.attendance_prompted_at = new Date(Date.now()).toISOString();
        const id = `n${nextId++}`;
        (tables.notifications ??= []).push({
          id,
          user_id: g.host_id,
          type: "game_attendance_prompt",
          title: args._title,
          body: args._body,
          link: args._link,
          created_at: new Date(Date.now()).toISOString(),
        });
        return { data: id, error: null };
      }
      throw new Error(`fake rpc: unsupported ${fn}`);
    },
  };
  return { admin, tables, readsOf: (t: string) => reads.filter((r) => r === t).length, reads };
}

/**
 * public.invite_pushes_allowed (20261129100000) over the fake tables, for the cases these tests set up: the invitation is
 * pending, its game is open (not cancelled, completed, under way or hidden, and still ahead), the host is not suspended or
 * banned, no block either way, and a guardian has not turned the child's messaging or games off. The real rule (with the
 * minor messaging rules and the age range) is proven against the database in 982_notification_push_sent_at.test.sql.
 */
function invitePushesAllowed(tables: Record<string, Row[]>, args: Record<string, unknown>) {
  const ids = (args._invites as string[]).map((v) => v.toLowerCase());
  const gameOpen = (id: unknown) =>
    (tables.hosted_games ?? []).some(
      (g) =>
        g.id === id &&
        g.cancelled_at == null &&
        g.completed_at == null &&
        !["cancelled", "completed", "in_progress"].includes(String(g.status ?? "")) &&
        g.hidden_at == null &&
        g.moderator_hidden_at == null &&
        g.org_hidden_at == null &&
        Date.parse(String(g.date)) > Date.now(),
    );
  const hostOk = (id: unknown) =>
    !(tables.profiles ?? []).some(
      (p) =>
        p.id === id &&
        (p.suspended_at != null || ["suspended", "banned"].includes(String(p.moderation_state))),
    );
  const blocked = (a: unknown, b: unknown) =>
    (tables.user_blocks ?? []).some(
      (x) =>
        (x.blocker_id === a && x.blocked_id === b) || (x.blocker_id === b && x.blocked_id === a),
    );
  const guardianOk = (id: unknown) => {
    const c = (tables.child_controls ?? []).find((x) => x.child_user_id === id);
    return !c || (c.messaging !== "off" && c.game_participation !== false);
  };
  return (tables.game_invites ?? [])
    .filter(
      (i) =>
        ids.includes(String(i.id).toLowerCase()) &&
        i.status === "pending" &&
        gameOpen(i.game_id) &&
        hostOk(i.host_id) &&
        !blocked(i.host_id, i.invitee_id) &&
        guardianOk(i.invitee_id),
    )
    .map((i) => ({ id: i.id, host_id: i.host_id, invitee_id: i.invitee_id }));
}

/** PostgREST's `or=(a.is.null,b.neq.x,c.not.is.null)`, for the forms the sweeps use. */
function orFilter(f: string): (r: Row) => boolean {
  const parts = f.split(",").map((cond) => {
    const [col, ...rest] = cond.split(".");
    const negate = rest[0] === "not";
    if (negate) rest.shift();
    const [op, ...v] = rest;
    const raw = v.join(".");
    const val = raw === "null" ? null : raw === "true" ? true : raw === "false" ? false : raw;
    const test = (r: Row): boolean => {
      const x = r[col!] ?? null;
      if (op === "is") return x === val;
      if (op === "eq") return x != null && String(x) === String(val);
      if (op === "neq") return x != null && String(x) !== String(val);
      throw new Error(`fake or(): unsupported ${cond}`);
    };
    return negate ? (r: Row) => !test(r) : test;
  });
  return (r) => parts.some((p) => p(r));
}

// ------------------------------------------------------------------------------------------------ WP 5.4

const GAME_START = Date.parse("2026-12-01T23:30:00Z");
const invite = (id: string, user: string, minutesAgo: number, over: Row = {}): Row => ({
  id,
  user_id: user,
  type: "game_invite",
  title: "You're invited to Sunday Run",
  body: "Basketball · Tue, Dec 1 at 6:30 PM",
  link: `/games/g1?invite=1&from=host&inv=00000000-0000-0000-0000-00000000000${id.slice(-1)}&exp=${GAME_START}`,
  read_at: null,
  push_sent_at: null,
  created_at: ago(minutesAgo),
  ...over,
});
const accepted = (id: string, host: string, minutesAgo: number, over: Row = {}): Row => ({
  id,
  user_id: host,
  type: "game_invite_accepted",
  title: "Sam accepted your invitation",
  body: "Sunday Run",
  link: "/games/g1",
  read_at: null,
  push_sent_at: null,
  created_at: ago(minutesAgo),
  ...over,
});

/**
 * The invitations behind invite notifications, as game_invite_player and game_respond_invite leave them: a pending invite
 * (from "host") for each invite row's `inv=`, and an accepted invite (by "sam", answered as the row was written) for each
 * acceptance row.
 */
function standingInvites(notifications: Row[]): Row[] {
  return notifications.flatMap((n): Row[] => {
    const link = String(n.link ?? "");
    if (n.type === "game_invite") {
      const inv = new URL(link, "https://app.local").searchParams.get("inv");
      if (!inv) return [];
      return [
        {
          id: inv,
          game_id: "g1",
          host_id: "host",
          invitee_id: n.user_id,
          status: "pending",
          created_at: n.created_at,
          responded_at: null,
        },
      ];
    }
    if (n.type === "game_invite_accepted") {
      return [
        {
          id: `acc-${String(n.id)}`,
          game_id: link.split("/")[2]?.split(/[?#]/)[0] ?? "g1",
          host_id: n.user_id,
          invitee_id: "sam",
          status: "accepted",
          created_at: ago(120),
          responded_at: n.created_at,
        },
      ];
    }
    return [];
  });
}
/** fakeDb with the invitations behind the notifications standing, unless the test sets game_invites itself. */
function inviteDb(tables: Record<string, Row[]>, opts?: Parameters<typeof fakeDb>[1]) {
  return fakeDb(
    {
      ...tables,
      game_invites: tables.game_invites ?? standingInvites(tables.notifications ?? []),
      hosted_games: tables.hosted_games ?? [openGame()],
    },
    opts,
  );
}
/** The game the invitations are for: upcoming, open for invitations. */
const openGame = (over: Row = {}): Row => ({
  id: "g1",
  host_id: "host",
  title: "Sunday Run",
  date: new Date(GAME_START).toISOString(),
  status: "open",
  cancelled_at: null,
  completed_at: null,
  hidden_at: null,
  moderator_hidden_at: null,
  org_hidden_at: null,
  ...over,
});

describe("pushInviteNotifications (WP 5.4)", () => {
  it("pushes each invite and acceptance once, with the notification's own title, body and link", async () => {
    const { admin, tables } = inviteDb({
      notifications: [invite("i1", "kim", 3), accepted("a1", "host", 2)],
    });
    const first = await pushInviteNotifications(admin, { now: NOW });
    expect(first).toEqual({ taken: 2, pushed: 2, passed: 0, deferred: 0 });
    expect(sent()).toEqual([
      expect.objectContaining({
        include_aliases: { external_id: ["kim"] },
        headings: { en: "You're invited to Sunday Run" },
        contents: { en: "Basketball · Tue, Dec 1 at 6:30 PM" },
        url: expect.stringMatching(/^https:\/\/ballacity\.test\/games\/g1\?invite=1&/),
      }),
      expect.objectContaining({
        include_aliases: { external_id: ["host"] },
        headings: { en: "Sam accepted your invitation" },
        contents: { en: "Sunday Run" },
        url: "https://ballacity.test/games/g1",
      }),
    ]);
    expect(tables.notifications!.every((n) => n.push_sent_at === new Date(NOW).toISOString())).toBe(
      true,
    );
    // The delivery log links each push to its notification, as for reminders.
    expect(logged().map((l) => [l.row.notification_id, l.row.status])).toEqual([
      ["i1", "sent"],
      ["a1", "sent"],
    ]);

    // The next run (5 minutes later) finds nothing left to push.
    const again = await pushInviteNotifications(admin, { now: NOW + 5 * 60_000 });
    expect(again).toEqual({ taken: 0, pushed: 0, passed: 0, deferred: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("two runs at once push each row once: the claim, not the read, decides", async () => {
    const { admin, tables } = inviteDb({
      notifications: [
        invite("i1", "kim", 3),
        accepted("a1", "host", 2),
        invite("i2", "lee", 4, { read_at: ago(1) }),
      ],
    });
    const [a, b] = await Promise.all([
      pushInviteNotifications(admin, { now: NOW }),
      pushInviteNotifications(admin, { now: NOW }),
    ]);
    // Both runs read the same three rows; each row was taken by exactly one of them.
    expect(a.taken + b.taken).toBe(3);
    expect(a.pushed + b.pushed).toBe(2);
    expect(
      sent()
        .map((s) => s.include_aliases.external_id[0])
        .sort(),
    ).toEqual(["host", "kim"]);
    expect(tables.notifications!.every((n) => n.push_sent_at != null)).toBe(true);
  });

  it("skips rows older than 1 hour and leaves them untouched", async () => {
    const { admin, tables } = inviteDb({
      notifications: [invite("i1", "kim", 61), accepted("a1", "host", 59)],
    });
    expect(await pushInviteNotifications(admin, { now: NOW })).toEqual({
      taken: 1,
      pushed: 1,
      passed: 0,
      deferred: 0,
    });
    expect(sent().map((s) => s.include_aliases.external_id[0])).toEqual(["host"]);
    expect(tables.notifications!.find((n) => n.id === "i1")!.push_sent_at).toBeNull();
  });

  it("pushes no other notification type", async () => {
    const { admin } = inviteDb({
      notifications: [
        invite("r1", "kim", 2, { type: "game_reminder" }),
        invite("m1", "kim", 2, { type: "message" }),
      ],
    });
    expect((await pushInviteNotifications(admin, { now: NOW })).taken).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("respects a minor's quiet hours: the push is held for the flush job, not sent, and the row is taken once", async () => {
    curfewGateFor.mockResolvedValue({
      action: "queue",
      deliverAfter: "2026-11-30T11:00:00.000Z",
      decision: {},
    });
    const { admin, tables } = inviteDb({ notifications: [invite("i1", "teen", 3)] });
    expect(await pushInviteNotifications(admin, { now: NOW })).toEqual({
      taken: 1,
      pushed: 1,
      passed: 0,
      deferred: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(held()).toEqual([
      {
        table: "scheduled_notifications",
        row: expect.objectContaining({
          user_id: "teen",
          title: "You're invited to Sunday Run",
          body: "Basketball · Tue, Dec 1 at 6:30 PM",
          channel: "push",
          reason: "minor_notification_curfew",
          deliver_after: "2026-11-30T11:00:00.000Z",
        }),
      },
    ]);
    expect(tables.notifications![0]!.push_sent_at).not.toBeNull();
    await pushInviteNotifications(admin, { now: NOW + 5 * 60_000 });
    expect(held()).toHaveLength(1);
  });

  it("drops a held invite push that would come out after the game started (exp in the link)", async () => {
    curfewGateFor.mockResolvedValue({
      action: "queue",
      deliverAfter: "2026-12-02T11:00:00.000Z",
      decision: {},
    });
    const { admin } = inviteDb({ notifications: [invite("i1", "teen", 3)] });
    await pushInviteNotifications(admin, { now: NOW });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(held()).toEqual([]);
    expect(logged().map((l) => [l.row.status, l.row.error])).toEqual([["skipped", "expired"]]);
    expect(inviteLinkExpiry(String(invite("i1", "x", 1).link))).toBe(
      new Date(GAME_START).toISOString(),
    );
    expect(inviteLinkExpiry("/games/g1")).toBeNull();
  });

  it("a guardian's off switch stops the push (deliverPush's gate)", async () => {
    curfewGateFor.mockResolvedValue({ action: "blocked", reason: "guardian_notifications_off" });
    const { admin } = inviteDb({ notifications: [invite("i1", "teen", 3)] });
    await pushInviteNotifications(admin, { now: NOW });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged().map((l) => l.row.error)).toEqual(["guardian_notifications_off"]);
  });

  it("does nothing without the OneSignal key: no request leaves, the log says not_configured", async () => {
    vi.stubEnv("ONESIGNAL_REST_API_KEY", "");
    const { admin, tables } = inviteDb({ notifications: [invite("i1", "kim", 3)] });
    await pushInviteNotifications(admin, { now: NOW });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged().map((l) => [l.row.status, l.row.error])).toEqual([
      ["skipped", "not_configured"],
    ]);
    // Taken all the same: a later key does not replay an old invite.
    expect(tables.notifications![0]!.push_sent_at).not.toBeNull();
  });

  it("respects each member's settings: Invitations for invites, Game updates for acceptances; read rows are not pushed", async () => {
    const { admin, tables } = inviteDb({
      notifications: [
        invite("i1", "noinvites", 3),
        accepted("a1", "noinvites", 3),
        invite("i2", "noupdates", 3),
        accepted("a2", "noupdates", 3),
        invite("i3", "reader", 3, { read_at: ago(1) }),
      ],
      notification_preferences: [
        { user_id: "noinvites", prefs: { invitations: { inApp: true, push: false } } },
        { user_id: "noupdates", prefs: { gameUpdates: { inApp: true, push: false } } },
      ],
    });
    expect(await pushInviteNotifications(admin, { now: NOW })).toEqual({
      taken: 5,
      pushed: 2,
      passed: 3,
      deferred: 0,
    });
    expect(sent().map((s) => [s.include_aliases.external_id[0], s.headings.en])).toEqual([
      ["noinvites", "Sam accepted your invitation"],
      ["noupdates", "You're invited to Sunday Run"],
    ]);
    // Passed-over rows are taken too, so they are never pushed later.
    expect(tables.notifications!.every((n) => n.push_sent_at != null)).toBe(true);
  });

  it("takes nothing when the settings cannot be read, so the rows stay due", async () => {
    const { admin, tables } = inviteDb(
      { notifications: [invite("i1", "kim", 3)] },
      { failPrefs: true },
    );
    await expect(pushInviteNotifications(admin, { now: NOW })).rejects.toThrow(/down/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tables.notifications![0]!.push_sent_at).toBeNull();
  });

  it("no push once a block exists either way between the host and the invitee; the row is taken, never retried", async () => {
    const rows = [invite("i1", "kim", 3), invite("i2", "lee", 3)];
    const { admin, tables } = inviteDb({
      notifications: rows,
      user_blocks: [
        { blocker_id: "kim", blocked_id: "host" }, // the invitee blocked the host after the invite
        { blocker_id: "host", blocked_id: "lee" }, // the host blocked the invitee
      ],
    });
    expect(await pushInviteNotifications(admin, { now: NOW })).toEqual({
      taken: 2,
      pushed: 0,
      passed: 2,
      deferred: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(held()).toEqual([]);
    expect(tables.notifications!.every((n) => n.push_sent_at != null)).toBe(true);
  });

  it("no push for an invitation the host cancelled or the player declined (or that is gone)", async () => {
    const rows = [invite("i1", "kim", 3), invite("i2", "lee", 3), invite("i3", "max", 3)];
    const standing = standingInvites(rows);
    standing[0]!.status = "cancelled";
    standing[1]!.status = "declined";
    const { admin } = inviteDb({ notifications: rows, game_invites: [standing[0]!, standing[1]!] });
    expect(await pushInviteNotifications(admin, { now: NOW })).toEqual({
      taken: 3,
      pushed: 0,
      passed: 3,
      deferred: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no push when the invitation names someone else (a guardian's copy, link /parent): only the invitee is pushed", async () => {
    const { admin } = inviteDb({
      notifications: [
        invite("i1", "teen", 3),
        invite("p1", "parent", 3, { title: "Game invitation for your player", link: "/parent" }),
        // A row whose inv= names an invitation to somebody else.
        invite("x1", "mal", 3),
      ],
      game_invites: standingInvites([invite("i1", "teen", 3)]),
    });
    expect(await pushInviteNotifications(admin, { now: NOW })).toEqual({
      taken: 3,
      pushed: 1,
      passed: 2,
      deferred: 0,
    });
    expect(sent().map((s) => s.include_aliases.external_id[0])).toEqual(["teen"]);
  });

  it("no acceptance push to a host who blocked the player who accepted, or was blocked by them", async () => {
    const rows = [accepted("a1", "host", 3), accepted("a2", "host2", 3)];
    const standing = standingInvites(rows);
    standing[1]!.invitee_id = "pat";
    const { admin } = inviteDb({
      notifications: rows,
      game_invites: standing,
      user_blocks: [
        { blocker_id: "host", blocked_id: "sam" },
        { blocker_id: "pat", blocked_id: "host2" },
      ],
    });
    expect(await pushInviteNotifications(admin, { now: NOW })).toEqual({
      taken: 2,
      pushed: 0,
      passed: 2,
      deferred: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no acceptance push when no accepted invitation stands behind the row", async () => {
    const { admin } = inviteDb({ notifications: [accepted("a1", "host", 3)], game_invites: [] });
    expect((await pushInviteNotifications(admin, { now: NOW })).pushed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks nothing it cannot read: a failed invitation check takes nothing, so the rows stay due", async () => {
    const t = inviteDb(
      { notifications: [invite("i1", "kim", 3)] },
      { failRpc: "invite_pushes_allowed" },
    );
    await expect(pushInviteNotifications(t.admin, { now: NOW })).rejects.toThrow(
      /invite_pushes_allowed down/,
    );
    expect(t.tables.notifications![0]!.push_sent_at).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a client without the invitation check pushes nothing and takes nothing (no guess)", async () => {
    const t = inviteDb({ notifications: [invite("i1", "kim", 3)] });
    const admin: ReminderAdmin = { from: t.admin.from.bind(t.admin) };
    await expect(pushInviteNotifications(admin, { now: NOW })).rejects.toThrow(
      /invitation check unavailable/,
    );
    expect(t.tables.notifications![0]!.push_sent_at).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a later read that fails still sends the pushes of the rows already taken, then reports the failure", async () => {
    const rows = [
      invite("i1", "kim", 5),
      invite("p1", "parent", 4, { title: "Game invitation for your player", link: "/parent" }),
      invite("i2", "lee", 3),
    ];
    // Two rows a read: the first read is full (kim's invite and a guardian's copy, one push), so a second read follows,
    // and its settings read fails.
    const { admin, tables } = inviteDb({ notifications: rows }, { failPrefsFrom: 2 });
    await expect(pushInviteNotifications(admin, { now: NOW, max: 2 })).rejects.toThrow(/down/);
    expect(sent().map((s) => s.include_aliases.external_id[0])).toEqual(["kim"]);
    expect(tables.notifications!.find((n) => n.id === "i2")!.push_sent_at).toBeNull();
  });

  it("an acceptance link with a query or hash still finds its game", async () => {
    const rows = [accepted("a1", "host", 3, { link: "/games/g1?tab=overview#roster" })];
    const standing = standingInvites([accepted("a1", "host", 3)]);
    const { admin } = inviteDb({ notifications: rows, game_invites: standing });
    expect((await pushInviteNotifications(admin, { now: NOW })).pushed).toBe(1);
  });

  it("50 planted rows written before a real invite do not crowd it out, and none of them is pushed", async () => {
    const planted = Array.from({ length: 50 }, (_, i) =>
      invite(`f${i}`, "mal", 59, {
        title: "Planted",
        link: "https://evil.example/x",
      }),
    );
    const real = invite("i1", "kim", 2);
    const { admin, tables } = inviteDb({
      notifications: [...planted, real],
      game_invites: standingInvites([real]),
    });
    const summary = await pushInviteNotifications(admin, { now: NOW });
    expect(summary.pushed).toBe(1);
    expect(sent().map((s) => [s.include_aliases.external_id[0], s.headings.en])).toEqual([
      ["kim", "You're invited to Sunday Run"],
    ]);
    expect(tables.notifications!.find((n) => n.id === "i1")!.push_sent_at).not.toBeNull();
  });
});

describe("pushInviteNotifications: an invitation the app would no longer allow (WP 5.4)", () => {
  // Each invitation stays 'pending' through these changes: only game_respond_invite and game_cancel_invite change it.
  const rows = () => [invite("i1", "kim", 3), invite("i2", "lee", 3)];
  const runWith = async (tables: Record<string, Row[]>) => {
    const { admin } = inviteDb({ notifications: rows(), ...tables });
    return pushInviteNotifications(admin, { now: NOW });
  };

  it("no push when the host cancelled the game after inviting (host_cancel_game leaves the invitation pending)", async () => {
    for (const cancelled of [{ cancelled_at: ago(3) }, { status: "cancelled" }]) {
      fetchMock.mockClear();
      expect(await runWith({ hosted_games: [openGame(cancelled)] })).toEqual({
        taken: 2,
        pushed: 0,
        passed: 2,
        deferred: 0,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("no push when a moderator or the facility hid the game", async () => {
    for (const hidden of [
      { hidden_at: ago(2) },
      { moderator_hidden_at: ago(2) },
      { org_hidden_at: ago(2) },
    ]) {
      fetchMock.mockClear();
      expect((await runWith({ hosted_games: [openGame(hidden)] })).pushed).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("no push when the host was suspended or banned after inviting", async () => {
    for (const state of ["banned", "suspended"]) {
      fetchMock.mockClear();
      const summary = await runWith({
        profiles: [{ id: "host", moderation_state: state, suspended_at: ago(2) }],
      });
      expect(summary.pushed).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("no push when the child's guardian turned messaging or games off after the invite", async () => {
    const summary = await runWith({
      child_controls: [
        { child_user_id: "kim", messaging: "off", game_participation: true },
        { child_user_id: "lee", messaging: "guardian_only", game_participation: false },
      ],
    });
    expect(summary).toEqual({ taken: 2, pushed: 0, passed: 2, deferred: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(held()).toEqual([]);
  });

  it("an invitation that still stands is pushed (the control for the cases above)", async () => {
    expect((await runWith({ hosted_games: [openGame()] })).pushed).toBe(2);
  });
});

describe("pushInviteNotifications within the run's time (WP 5.4)", () => {
  // Ten invites, oldest first, each to its own player, each invitation standing.
  const ten = () => Array.from({ length: 10 }, (_, i) => invite(`i${i}`, `p${i}`, 20 - i));
  const db = () => inviteDb({ notifications: ten() });

  it("never stamps a row long before its push: a run cut off mid-push leaves at most one group stamped and unpushed", async () => {
    // Every push hangs: the Worker is cancelled while the first pushes are in flight.
    const handed: string[] = [];
    pushStandIn.fn = (p) => (handed.push(p.userId), new Promise(() => {}));
    const { admin, tables } = db();
    void pushInviteNotifications(admin, { now: NOW });
    await new Promise((r) => setTimeout(r, 50));
    const stamped = tables
      .notifications!.filter((n) => n.push_sent_at != null)
      .map((n) => String(n.user_id));
    expect(stamped.length).toBeGreaterThan(0);
    expect(stamped.length).toBeLessThanOrEqual(PUSH_CONCURRENCY);
    expect([...stamped].sort()).toEqual([...handed].sort());
  });

  it("stops taking rows once the run's time is up; the rest stay due for the next run", async () => {
    let t = 0;
    const clock = () => t;
    const handed: string[] = [];
    pushStandIn.fn = async (p) => {
      handed.push(p.userId);
      t += 1_000; // each push takes a second
    };
    const { admin, tables } = db();
    const first = await pushInviteNotifications(admin, { now: NOW, clock, budgetMs: 3_000 });
    expect(first).toEqual({ taken: 4, pushed: 4, passed: 0, deferred: 6 });
    expect(tables.notifications!.filter((n) => n.push_sent_at == null)).toHaveLength(6);

    t = 0;
    const second = await pushInviteNotifications(admin, {
      now: NOW + 5 * 60_000,
      clock,
      budgetMs: 3_000,
    });
    expect(second).toEqual({ taken: 4, pushed: 4, passed: 0, deferred: 2 });
    // Oldest first, each pushed once.
    expect(handed).toEqual(
      ten()
        .slice(0, 8)
        .map((n) => n.user_id),
    );
  });

  it("a run whose time is already up reads and takes nothing", async () => {
    const t = db();
    expect(await pushInviteNotifications(t.admin, { now: NOW, budgetMs: 0 })).toEqual({
      taken: 0,
      pushed: 0,
      passed: 0,
      deferred: 0,
    });
    expect(t.reads).toEqual([]);
    expect(t.tables.notifications!.every((n) => n.push_sent_at == null)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ WP 5.6

/** A 90-minute game hosted by "host" that started `startedMinAgo` minutes ago. */
const game = (id: string, startedMinAgo: number, over: Row = {}): Row => ({
  id,
  host_id: "host",
  title: `Run ${id}`,
  date: ago(startedMinAgo),
  duration: "90 min",
  ends_at: null,
  status: null,
  cancelled_at: null,
  attendance_prompted_at: null,
  location: "Secret Court, 12 Hidden St",
  ...over,
});
const player = (gameId: string, userId: string, over: Row = {}): Row => ({
  game_id: gameId,
  user_id: userId,
  attended: null,
  attendance_marked_at: null,
  ...over,
});
/** Ended 2 hours 10 minutes ago: due. */
const DUE = 90 + 130;
const prompts = (t: Record<string, Row[]>) =>
  (t.notifications ?? []).filter((n) => n.type === ATTENDANCE_PROMPT_TYPE);

describe("promptHostsForAttendance (WP 5.6)", () => {
  it("sends the host one notice and one push per game, 2 hours after it ends, linking to the Attendance block", async () => {
    const { admin, tables } = fakeDb({
      hosted_games: [game("g1", DUE)],
      game_participants: [player("g1", "host"), player("g1", "alex")],
    });
    expect(await promptHostsForAttendance(admin, { now: NOW })).toEqual({
      prompted: 1,
      pushed: 1,
      deferred: 0,
    });
    expect(prompts(tables)).toEqual([
      expect.objectContaining({
        user_id: "host",
        type: "game_attendance_prompt",
        title: "Who showed up at Run g1?",
        body: "Mark who showed up. It builds your host reliability score.",
        link: "/games/g1?tab=overview#attendance",
      }),
    ]);
    expect(sent()).toEqual([
      expect.objectContaining({
        include_aliases: { external_id: ["host"] },
        headings: { en: "Who showed up at Run g1?" },
        contents: { en: "Mark who showed up. It builds your host reliability score." },
        url: "https://ballacity.test/games/g1?tab=overview#attendance",
      }),
    ]);
    expect(tables.hosted_games![0]!.attendance_prompted_at).toBe(new Date(NOW).toISOString());

    // Later runs, the same day and the next: nothing more.
    await promptHostsForAttendance(admin, { now: NOW + 5 * 60_000 });
    await promptHostsForAttendance(admin, { now: NOW + 20 * 60 * 60_000 });
    expect(prompts(tables)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("two runs at once prompt once", async () => {
    const { admin, tables } = fakeDb({
      hosted_games: [game("g1", DUE)],
      game_participants: [player("g1", "alex")],
    });
    await Promise.all([
      promptHostsForAttendance(admin, { now: NOW }),
      promptHostsForAttendance(admin, { now: NOW }),
    ]);
    expect(prompts(tables)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits until 2 hours after the end (ends_at wins over the duration), and gives up after a day", async () => {
    const { admin, tables } = fakeDb({
      hosted_games: [
        game("early", 90 + 110), // ended 1 h 50 min ago
        game("late", 90 + 120 + 24 * 60 + 5), // due more than a day ago
        // Started 5 hours ago but ends_at says it ended 1 hour ago: not yet.
        game("long", 300, { ends_at: ago(60) }),
      ],
      game_participants: [player("early", "a"), player("late", "a"), player("long", "a")],
    });
    await promptHostsForAttendance(admin, { now: NOW });
    expect(prompts(tables)).toEqual([]);
    // An hour later the long game is due (ended 2 hours ago).
    await promptHostsForAttendance(admin, { now: NOW + 60 * 60_000 });
    expect(prompts(tables).map((n) => n.link)).toEqual([
      "/games/early?tab=overview#attendance",
      "/games/long?tab=overview#attendance",
    ]);
  });

  it("sends nothing for a cancelled game", async () => {
    const { admin, tables } = fakeDb({
      hosted_games: [
        game("g1", DUE, { status: "cancelled" }),
        game("g2", DUE, { cancelled_at: ago(300) }),
      ],
      game_participants: [player("g1", "alex"), player("g2", "alex")],
    });
    expect((await promptHostsForAttendance(admin, { now: NOW })).prompted).toBe(0);
    expect(prompts(tables)).toEqual([]);
    expect(tables.hosted_games!.every((g) => g.attendance_prompted_at == null)).toBe(true);
  });

  it("sends nothing once anyone's attendance is marked", async () => {
    const { admin, tables } = fakeDb({
      hosted_games: [game("g1", DUE), game("g2", DUE)],
      game_participants: [
        player("g1", "alex", { attended: true, attendance_marked_at: ago(10) }),
        player("g1", "blair"),
        player("g2", "alex", { attended: false }),
      ],
    });
    expect((await promptHostsForAttendance(admin, { now: NOW })).prompted).toBe(0);
    expect(prompts(tables)).toEqual([]);
  });

  it("sends nothing without a participant other than the host", async () => {
    const { admin, tables } = fakeDb({
      hosted_games: [game("g1", DUE), game("g2", DUE)],
      game_participants: [player("g1", "host")],
    });
    expect((await promptHostsForAttendance(admin, { now: NOW })).prompted).toBe(0);
    expect(prompts(tables)).toEqual([]);
  });

  it("prompts each game of a series once", async () => {
    const series = { series_id: "s1" };
    const { admin, tables } = fakeDb({
      hosted_games: [
        game("w1", DUE, series),
        game("w2", 90 + 60, series), // the next date, ended an hour ago
      ],
      game_participants: [player("w1", "alex"), player("w2", "alex")],
    });
    await promptHostsForAttendance(admin, { now: NOW });
    await promptHostsForAttendance(admin, { now: NOW + 70 * 60_000 });
    await promptHostsForAttendance(admin, { now: NOW + 75 * 60_000 });
    expect(prompts(tables).map((n) => n.link)).toEqual([
      "/games/w1?tab=overview#attendance",
      "/games/w2?tab=overview#attendance",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("puts no player's name and no venue in the push or the notice", async () => {
    const { admin, tables } = fakeDb({
      hosted_games: [game("g1", DUE)],
      game_participants: [player("g1", "alex"), player("g1", "blair")],
      profiles: [
        { id: "alex", display_name: "Alex Rivera" },
        { id: "blair", display_name: "Blair Chen" },
      ],
    });
    await promptHostsForAttendance(admin, { now: NOW });
    const text = JSON.stringify([sent(), prompts(tables)]);
    expect(text).not.toMatch(/Alex|Rivera|Blair|Chen|alex|blair|Secret Court|Hidden St/);
    expect(attendancePromptText("Run g1")).toEqual({
      title: "Who showed up at Run g1?",
      body: "Mark who showed up. It builds your host reliability score.",
    });
  });

  it("never reads profiles: the sweep has no names to leak", async () => {
    const t = fakeDb({
      hosted_games: [game("g1", DUE)],
      game_participants: [player("g1", "alex")],
    });
    await promptHostsForAttendance(t.admin, { now: NOW });
    expect(t.readsOf("profiles")).toBe(0);
  });

  it("follows the host's Game reminders push setting; the in-app notice still goes", async () => {
    const { admin, tables } = fakeDb({
      hosted_games: [game("g1", DUE)],
      game_participants: [player("g1", "alex")],
      notification_preferences: [
        { user_id: "host", prefs: { gameReminders: { inApp: true, push: false } } },
      ],
    });
    expect(await promptHostsForAttendance(admin, { now: NOW })).toEqual({
      prompted: 1,
      pushed: 0,
      deferred: 0,
    });
    expect(prompts(tables)).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("holds the push during a minor host's quiet hours", async () => {
    curfewGateFor.mockResolvedValue({
      action: "queue",
      deliverAfter: "2026-11-30T11:00:00.000Z",
      decision: {},
    });
    const { admin } = fakeDb({
      hosted_games: [game("g1", DUE)],
      game_participants: [player("g1", "alex")],
    });
    await promptHostsForAttendance(admin, { now: NOW });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(held()).toHaveLength(1);
  });

  it("leaves nothing stamped when the notice cannot be written, so the next run tries again", async () => {
    const tables: Record<string, Row[]> = {
      hosted_games: [game("g1", DUE)],
      game_participants: [player("g1", "alex")],
    };
    const broken = fakeDb(tables, { failInsert: true });
    expect((await promptHostsForAttendance(broken.admin, { now: NOW })).prompted).toBe(0);
    expect(tables.hosted_games![0]!.attendance_prompted_at).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    const fixed = fakeDb(tables);
    expect((await promptHostsForAttendance(fixed.admin, { now: NOW + 5 * 60_000 })).prompted).toBe(
      1,
    );
  });

  it("a run cut off part way never leaves a game stamped without its notice", async () => {
    // The stamp and the notice are one call (public.send_attendance_prompt): while it is in flight nothing is stamped, and
    // when it lands both are there. A run cancelled between them (pg_net's 5-second limit) cannot split them.
    const { admin, tables } = fakeDb({
      hosted_games: [game("g1", DUE), game("g2", DUE)],
      game_participants: [player("g1", "alex"), player("g2", "alex")],
      notification_preferences: [
        { user_id: "host", prefs: { gameReminders: { inApp: true, push: false } } },
      ],
    });
    const hanging: ReminderAdmin = {
      from: (table: string) => {
        const q = admin.from(table);
        // The notice write never comes back (the Worker was cancelled while it was in flight).
        if (table === "notifications")
          return { ...q, insert: () => new Promise(() => {}) } as never;
        return q;
      },
      rpc: (fn, args) =>
        fn === "send_attendance_prompt" ? new Promise(() => {}) : admin.rpc!(fn, args),
    };
    void promptHostsForAttendance(hanging, { now: NOW });
    await new Promise((r) => setTimeout(r, 50));
    const stamped = tables.hosted_games!.filter((g) => g.attendance_prompted_at != null);
    const noticed = new Set(prompts(tables).map((n) => n.link));
    expect(stamped.every((g) => noticed.has(attendancePromptLink(String(g.id))))).toBe(true);
  });

  it("a run whose time is already up reads nothing", async () => {
    const t = fakeDb({
      hosted_games: [game("g1", DUE)],
      game_participants: [player("g1", "alex")],
    });
    expect(await promptHostsForAttendance(t.admin, { now: NOW, budgetMs: 0 })).toEqual({
      prompted: 0,
      pushed: 0,
      deferred: 0,
    });
    expect(t.reads).toEqual([]);
    expect(t.tables.hosted_games![0]!.attendance_prompted_at).toBeNull();
  });
});

describe("promptHostsForAttendance at volume (WP 5.6)", () => {
  // These are about which games are prompted; the hosts have the push off so no push is in flight.
  const pushOff = [{ user_id: "host", prefs: { gameReminders: { inApp: true, push: false } } }];

  it("decides 'already marked' from the whole roster, not a response cut at the row cap", async () => {
    // 80 games of 13 players: 1040 roster rows, over a 1000-row response. Game x (the soonest due) had one player marked
    // after the others joined, so that row is stored last.
    const games = [game("x", DUE + 60)];
    const roster = Array.from({ length: 12 }, (_, i) => player("x", `p${i}`));
    for (let k = 0; k < 79; k++) {
      games.push(game(`g${k}`, DUE));
      for (let i = 0; i < 13; i++) roster.push(player(`g${k}`, `p${i}`));
    }
    roster.push(player("x", "p12", { attended: true, attendance_marked_at: ago(30) }));
    const { admin, tables } = fakeDb({
      hosted_games: games,
      game_participants: roster,
      notification_preferences: pushOff,
    });
    await promptHostsForAttendance(admin, { now: NOW });
    expect(prompts(tables).some((n) => n.link === attendancePromptLink("x"))).toBe(false);
    expect(prompts(tables)).toHaveLength(50);
  });

  it("finds a due game behind more than 1000 games that will never be prompted (cancelled, host only)", async () => {
    const games: Row[] = [];
    const roster: Row[] = [];
    for (let k = 0; k < 700; k++) games.push(game(`c${k}`, DUE + 30, { status: "cancelled" }));
    for (let k = 0; k < 500; k++) {
      games.push(game(`h${k}`, DUE + 30));
      roster.push(player(`h${k}`, "host"));
    }
    games.push(game("due", DUE));
    roster.push(player("due", "alex"));
    const { admin, tables } = fakeDb({
      hosted_games: games,
      game_participants: roster,
      notification_preferences: pushOff,
    });
    expect((await promptHostsForAttendance(admin, { now: NOW })).prompted).toBe(1);
    expect(prompts(tables).map((n) => n.link)).toEqual([attendancePromptLink("due")]);
  });

  it("prompts the oldest games it could read when there are more unprompted games than one run reads", async () => {
    // One row per response: a run reads 10 pages of games, so 10 of these 12.
    const games = Array.from({ length: 12 }, (_, i) =>
      game(`g${String(i).padStart(2, "0")}`, DUE + 12 - i),
    );
    const { admin, tables } = fakeDb(
      {
        hosted_games: games,
        game_participants: games.map((g) => player(String(g.id), "alex")),
        notification_preferences: pushOff,
      },
      { maxRows: 1 },
    );
    expect((await promptHostsForAttendance(admin, { now: NOW })).prompted).toBe(10);
    expect(prompts(tables).map((n) => n.link)).toEqual(
      games.slice(0, 10).map((g) => attendancePromptLink(String(g.id))),
    );
  });

  it("pages through whatever row cap the API has, and decides nothing on a roster it could not read whole", async () => {
    const roster = [
      ...Array.from({ length: 15 }, (_, i) => player("g1", `p${i}`)),
      player("g1", "q", { attended: true }),
    ];
    // Two rows per response: the marked row comes in the last page and is seen.
    const two = fakeDb(
      { hosted_games: [game("g1", DUE)], game_participants: roster },
      { maxRows: 2 },
    );
    expect((await promptHostsForAttendance(two.admin, { now: NOW })).prompted).toBe(0);
    // Without the marked row the game is prompted.
    const unmarked = fakeDb(
      {
        hosted_games: [game("g1", DUE)],
        game_participants: roster.slice(0, 15),
        notification_preferences: pushOff,
      },
      { maxRows: 2 },
    );
    expect((await promptHostsForAttendance(unmarked.admin, { now: NOW })).prompted).toBe(1);
    // One row per response and 30 players: more pages than a run reads. No prompt, and the game stays due.
    const one = fakeDb(
      {
        hosted_games: [game("g1", DUE)],
        game_participants: Array.from({ length: 30 }, (_, i) => player("g1", `p${i}`)),
      },
      { maxRows: 1 },
    );
    expect(await promptHostsForAttendance(one.admin, { now: NOW })).toEqual({
      prompted: 0,
      pushed: 0,
      deferred: 1,
    });
    expect(one.tables.hosted_games![0]!.attendance_prompted_at).toBeNull();
  });
});

describe("runScheduledSweeps: one run, one budget (WP 5.4 / 5.6)", () => {
  const tables = (): Record<string, Row[]> => ({
    notifications: [invite("i1", "kim", 3)],
    hosted_games: [openGame(), game("gdone", DUE)],
    game_participants: [player("gdone", "alex")],
  });

  it("runs the jobs one after another, not side by side: reminders, then invite pushes, then attendance prompts", async () => {
    const t = inviteDb(tables());
    const order: string[] = [];
    const admin: ReminderAdmin = {
      from: (table: string) => (order.push(table), t.admin.from(table)),
      rpc: (fn, args) => (order.push(`rpc:${fn}`), t.admin.rpc!(fn, args)),
    };
    const result = await runScheduledSweeps(admin);
    expect(result.errors).toEqual([]);
    expect(result.invitePushes).toMatchObject({ pushed: 1 });
    expect(result.attendancePrompts).toMatchObject({ prompted: 1 });
    const first = (x: string) => order.indexOf(x);
    const last = (x: string) => order.lastIndexOf(x);
    expect(last("game_reminders")).toBeLessThan(first("notifications"));
    expect(last("rpc:invite_pushes_allowed")).toBeLessThan(first("rpc:send_attendance_prompt"));
    // The attendance job's first read comes after the invite job's last write.
    const inviteDone = order.lastIndexOf("notifications", first("rpc:send_attendance_prompt"));
    expect(order.slice(0, inviteDone).includes("game_participants")).toBe(false);
  });

  it("shares one budget: once the reminders used it up, the other jobs take nothing and their rows stay due", async () => {
    const t = inviteDb(tables());
    let now = 0;
    const admin: ReminderAdmin = {
      from: (table: string) => {
        if (table === "game_reminders") now += 3_000; // the reminders job uses the run's whole time
        return t.admin.from(table);
      },
      rpc: t.admin.rpc,
    };
    const result = await runScheduledSweeps(admin, { clock: () => now });
    expect(result.invitePushes).toEqual({ taken: 0, pushed: 0, passed: 0, deferred: 0 });
    expect(result.attendancePrompts).toEqual({ prompted: 0, pushed: 0, deferred: 0 });
    expect(t.tables.notifications![0]!.push_sent_at).toBeNull();
    expect(t.tables.hosted_games!.find((g) => g.id === "gdone")!.attendance_prompted_at).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("one job failing does not stop the others, and the run reports it", async () => {
    const t = inviteDb(tables(), { failRpc: "invite_pushes_allowed" });
    const result = await runScheduledSweeps(t.admin);
    expect(result.invitePushes).toBeNull();
    expect(result.errors).toEqual(["invitation check failed: invite_pushes_allowed down"]);
    expect(result.reminders).not.toBeNull();
    expect(result.attendancePrompts).toMatchObject({ prompted: 1 });
  });
});

describe("wiring (WP 5.4 / 5.6)", () => {
  it("the scheduled run calls the sweeps through one budget, and the prompt's link has its anchor on the game page", () => {
    const route = readFileSync("src/routes/api/public/reminders/run.ts", "utf8");
    expect(route).toMatch(/runScheduledSweeps\(\s*supabaseAdmin as never,?\s*\)/);
    expect(route).not.toMatch(/Promise\.allSettled/);
    expect(attendancePromptLink("g1")).toBe("/games/g1?tab=overview#attendance");
    const page = readFileSync("src/routes/games.$gameId.index.tsx", "utf8");
    expect(page).toMatch(/<HashScrollTarget\s+id="attendance"/);
  });
});

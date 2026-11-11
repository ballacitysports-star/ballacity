import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { formatDatedWhen, formatNotificationWhen } from "./format";
import {
  dueOffset,
  leadText,
  sendDueGameReminders,
  type ReminderAdmin,
  type ReminderGame,
  type ReminderRow,
} from "./game-reminders.server";
import type { PushInput } from "./push.server";

// The push provider is replaced: these tests check what the sweep asks it to send.
const { deliverPush } = vi.hoisted(() => ({
  deliverPush: vi.fn(async (_input: PushInput) => ({ ok: true as const, recipients: 1 })),
}));
vi.mock("@/lib/push.server", () => ({ deliverPush }));
beforeEach(() => {
  deliverPush.mockReset();
  deliverPush.mockImplementation(async () => ({ ok: true as const, recipients: 1 }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const pushes = () => deliverPush.mock.calls.map(([input]) => input);

const NOW = Date.parse("2026-11-08T12:00:00Z");
const inMinutes = (m: number) => new Date(NOW + m * 60_000).toISOString();
const READ_AT = "2026-11-01T09:00:00.123456+00:00";

/** The columns each table really has, read from the generated types, as PostgREST would check. */
const columnCache = new Map<string, string[]>();
function columnsOf(table: string): string[] {
  if (!columnCache.has(table)) {
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    const start = types.indexOf(`      ${table}: {\n        Row: {`);
    if (start < 0) throw new Error(`no ${table} in types.ts`);
    const body = types.slice(start).split("\n        }\n")[0]!;
    columnCache.set(
      table,
      [...body.matchAll(/^ {10}(\w+)\??:/gm)].map((m) => m[1]!),
    );
  }
  return columnCache.get(table)!;
}

type Pair = [gameId: string, userId: string];
type JoinRequest = { game_id: string; player_id: string; status: string };

/**
 * An in-memory admin client for game_reminders, hosted_games, notifications,
 * notification_preferences (`prefs`: user id → stored prefs; no entry, no row),
 * game_participants (`roster`; by default every reminder's player holds a place) and
 * join_requests. A query runs when it is awaited, as PostgREST's does.
 */
function fakeAdmin(
  reminders: ReminderRow[],
  games: ReminderGame[],
  opts: {
    failInsert?: boolean;
    prefs?: Record<string, unknown>;
    failPrefs?: boolean;
    roster?: Pair[];
    requests?: JoinRequest[];
    failRoster?: boolean;
    failRequests?: boolean;
    /** Runs as a claim is made, before it is checked: another caller can get there first. */
    beforeClaim?: () => void;
    /** Runs as a delete is sent, before it is applied. */
    beforeDelete?: () => void;
  } = {},
) {
  const roster = opts.roster ?? reminders.map((r): Pair => [r.game_id, r.user_id]);
  const notifications: Record<string, unknown>[] = [];
  const reads: string[] = [];
  const deleted: string[] = [];
  const source: Record<string, () => Record<string, unknown>[]> = {
    game_reminders: () => reminders,
    hosted_games: () => games,
    notification_preferences: () =>
      Object.entries(opts.prefs ?? {}).map(([user_id, prefs]) => ({ user_id, prefs })),
    game_participants: () => roster.map(([game_id, user_id]) => ({ game_id, user_id })),
    join_requests: () => opts.requests ?? [],
  };
  const down = (opts.failPrefs ? ["notification_preferences"] : [])
    .concat(opts.failRoster ? ["game_participants"] : [])
    .concat(opts.failRequests ? ["join_requests"] : []);

  const admin: ReminderAdmin = {
    from(table: string) {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      let mode: "read" | "update" | "delete" | "insert" = "read";
      let patch: Record<string, unknown> | null = null;
      let row: Record<string, unknown> | null = null;
      let badColumn: string | null = null;
      const run = () => {
        if (badColumn) return { data: null, error: { message: `column ${badColumn} missing` } };
        if (mode === "insert") {
          if (opts.failInsert) return { data: null, error: { message: "boom" } };
          const id = `n${notifications.length + 1}`;
          notifications.push({ id, ...row });
          return { data: [{ id }], error: null };
        }
        if (mode === "read") reads.push(table);
        if (down.includes(table)) return { data: null, error: { message: "down" } };
        if (mode === "delete") opts.beforeDelete?.();
        const rows = (source[table]?.() ?? []).filter((r) => filters.every((f) => f(r)));
        if (mode === "update") {
          for (const r of rows) Object.assign(r, patch);
          return { data: rows.map((r) => ({ id: r.id })), error: null };
        }
        if (mode === "delete") {
          for (const r of rows) {
            reminders.splice(reminders.indexOf(r as never), 1);
            deleted.push(String(r.id));
          }
          return { data: rows.map((r) => ({ id: r.id })), error: null };
        }
        return { data: rows.map((r) => ({ ...r })), error: null };
      };
      const q: Record<string, unknown> = {
        select: (cols: string) => {
          const known = columnsOf(table);
          const unknown = cols
            .split(",")
            .map((c) => c.trim())
            .find((c) => !known.includes(c));
          badColumn = unknown ? `${table}.${unknown}` : null;
          return q;
        },
        limit: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
        gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), q),
        lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), q),
        lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), q),
        or: (f: string) => {
          // only the claim filter is used: last_sent_offset.is.null,last_sent_offset.gt.N
          opts.beforeClaim?.();
          const n = Number(f.split("gt.")[1]);
          filters.push((r) => r.last_sent_offset == null || Number(r.last_sent_offset) > n);
          return q;
        },
        update: (p: Record<string, unknown>) => ((mode = "update"), (patch = p), q),
        delete: () => ((mode = "delete"), q),
        insert: (r: Record<string, unknown>) => ((mode = "insert"), (row = r), q),
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve().then(run).then(ok, ko),
      };
      return q as never;
    },
  };
  const readsOf = (table: string) => reads.filter((t) => t === table).length;
  return { admin, notifications, readsOf, deleted };
}

const game = (id: string, startsIn: number, over: Partial<ReminderGame> = {}): ReminderGame => ({
  id,
  title: `Game ${id}`,
  date: inMinutes(startsIn),
  location: "Court 1",
  all_day: false,
  ...over,
});
const rem = (
  id: string,
  user: string,
  gameId: string,
  offsets: number[],
  last: number | null = null,
): ReminderRow => ({
  id,
  user_id: user,
  game_id: gameId,
  offsets,
  last_sent_offset: last,
  updated_at: READ_AT,
});

describe("dueOffset", () => {
  it("picks the smallest window that has opened and was not sent, so the larger ones pass with it", () => {
    expect(dueOffset([1440, 120], null, 100)).toBe(120);
    expect(dueOffset([1440, 120], 1440, 100)).toBe(120);
    expect(dueOffset([1440, 120], 120, 100)).toBeNull();
    expect(dueOffset([1440, 120], null, 1000)).toBe(1440);
    expect(dueOffset([10080, 1440, 120], null, 1000)).toBe(1440);
    expect(dueOffset([1440, 120], null, 2000)).toBeNull();
    expect(dueOffset([], null, 10)).toBeNull();
  });
});

describe("leadText", () => {
  it("words a whole window as before", () => {
    expect([leadText(30), leadText(60), leadText(120), leadText(1440), leadText(2880)]).toEqual([
      "30 minutes",
      "1 hour",
      "2 hours",
      "1 day",
      "2 days",
    ]);
  });

  it("words the minutes actually left: exact under 3 hours, whole hours, then days", () => {
    expect(leadText(100)).toBe("1 hour 40 minutes");
    expect(leadText(90)).toBe("1 hour 30 minutes");
    expect(leadText(115)).toBe("2 hours"); // a run a few minutes into the 2-hour window
    expect(leadText(1435)).toBe("1 day");
    expect(leadText(1300)).toBe("22 hours");
    expect(leadText(2100)).toBe("35 hours");
    expect(leadText(10075)).toBe("7 days");
    expect(leadText(25)).toBe("25 minutes");
    expect(leadText(0.4)).toBe("1 minute");
  });
});

describe("sendDueGameReminders (P2-7)", () => {
  it("sends every player's due reminder once, with the game's title and link", async () => {
    const reminders = [
      rem("r1", "u1", "g1", [1440, 120]),
      rem("r2", "u2", "g1", [120]),
      rem("r3", "u3", "g2", [60]),
    ];
    const { admin, notifications } = fakeAdmin(reminders, [game("g1", 100), game("g2", 600)]);
    const out = await sendDueGameReminders(admin, { now: NOW });
    expect(out.sent).toBe(2);
    expect(notifications.map((n) => [n.user_id, n.title, n.link])).toEqual([
      ["u1", "Game g1 starts in 1 hour 40 minutes", "/games/g1"],
      ["u2", "Game g1 starts in 1 hour 40 minutes", "/games/g1"],
    ]);
    expect(reminders.map((r) => r.last_sent_offset)).toEqual([120, 120, null]);
  });

  it("never sends the same reminder twice, even when two runs overlap", async () => {
    const reminders = [rem("r1", "u1", "g1", [120])];
    const { admin, notifications } = fakeAdmin(reminders, [game("g1", 100)]);
    await Promise.all([
      sendDueGameReminders(admin, { now: NOW }),
      sendDueGameReminders(admin, { now: NOW }),
    ]);
    await sendDueGameReminders(admin, { now: NOW });
    expect(notifications).toHaveLength(1);
  });

  it("limits to one player when asked (the app's own flush)", async () => {
    const reminders = [rem("r1", "u1", "g1", [120]), rem("r2", "u2", "g1", [120])];
    const { admin, notifications } = fakeAdmin(reminders, [game("g1", 100)]);
    await sendDueGameReminders(admin, { now: NOW, userId: "u2" });
    expect(notifications.map((n) => n.user_id)).toEqual(["u2"]);
  });

  it("skips cancelled and past games", async () => {
    const reminders = [rem("r1", "u1", "g1", [120]), rem("r2", "u1", "g2", [120])];
    const { admin, notifications } = fakeAdmin(reminders, [
      game("g1", 100, { status: "cancelled" }),
      game("g2", -10),
    ]);
    expect((await sendDueGameReminders(admin, { now: NOW })).sent).toBe(0);
    expect(notifications).toHaveLength(0);
  });

  it("gives the claim back when the notification cannot be written, so the next run retries", async () => {
    const reminders = [rem("r1", "u1", "g1", [120])];
    const { admin } = fakeAdmin(reminders, [game("g1", 100)], { failInsert: true });
    expect((await sendDueGameReminders(admin, { now: NOW })).sent).toBe(0);
    expect(reminders[0].last_sent_offset).toBeNull();
  });
});

describe("sendDueGameReminders: one reminder when several windows are open (P2-7 review)", () => {
  it("a player who joins 100 minutes before a [1 day, 2 hours] game gets one reminder, worded from the time left", async () => {
    const reminders = [rem("r1", "u1", "g1", [1440, 120])];
    const { admin, notifications } = fakeAdmin(reminders, [game("g1", 100)]);
    await sendDueGameReminders(admin, { now: NOW });
    expect(notifications.map((n) => n.title)).toEqual(["Game g1 starts in 1 hour 40 minutes"]);
    expect(pushes().map((p) => p.title)).toEqual(["Game g1 starts in 1 hour 40 minutes"]);
    // Both windows are passed in the one claim: nothing more on the next runs.
    expect(reminders[0].last_sent_offset).toBe(120);
    await sendDueGameReminders(admin, { now: NOW + 5 * 60_000 });
    await sendDueGameReminders(admin, { now: NOW + 60 * 60_000 });
    expect(notifications).toHaveLength(1);
  });

  it("still sends a later window once it opens", async () => {
    const reminders = [rem("r1", "u1", "g1", [1440, 30])];
    const { admin, notifications } = fakeAdmin(reminders, [game("g1", 1435)]);
    await sendDueGameReminders(admin, { now: NOW });
    await sendDueGameReminders(admin, { now: NOW + 1407 * 60_000 }); // 28 minutes before
    expect(notifications.map((n) => n.title)).toEqual([
      "Game g1 starts in 1 day",
      "Game g1 starts in 28 minutes",
    ]);
  });
});

describe("sendDueGameReminders: who gets a reminder (P2-7 review)", () => {
  it("pushes only to players with a place; an open request gets the in-app reminder only", async () => {
    const reminders = [
      rem("r1", "u1", "g1", [120]), // on the roster
      rem("r2", "u2", "g1", [120]), // request pending
      rem("r3", "u3", "g1", [120]), // request approved, no place yet (e.g. not paid)
    ];
    const { admin, notifications } = fakeAdmin(reminders, [game("g1", 100)], {
      roster: [["g1", "u1"]],
      requests: [
        { game_id: "g1", player_id: "u2", status: "pending" },
        { game_id: "g1", player_id: "u3", status: "approved" },
      ],
    });
    const out = await sendDueGameReminders(admin, { now: NOW });
    expect(notifications.map((n) => n.user_id)).toEqual(["u1", "u2", "u3"]);
    expect(pushes().map((p) => p.userId)).toEqual(["u1"]);
    expect(out).toMatchObject({ sent: 3, pushed: 1, removed: 0 });
    expect(reminders.map((r) => r.last_sent_offset)).toEqual([120, 120, 120]);
  });

  it("sends nothing to players who left, were removed or declined, and deletes that game's reminder row", async () => {
    const reminders = [
      rem("r1", "u1", "g1", [120]), // on the roster
      rem("r2", "u2", "g1", [120]), // request declined
      rem("r3", "u3", "g1", [120]), // request withdrawn
      rem("r4", "u4", "g1", [120]), // left or removed: no place, no request
      rem("r5", "u4", "g2", [120]), // ...but still in another game
    ];
    const { admin, notifications, deleted } = fakeAdmin(
      reminders,
      [game("g1", 100), game("g2", 110)],
      {
        roster: [
          ["g1", "u1"],
          ["g2", "u4"],
        ],
        requests: [
          { game_id: "g1", player_id: "u2", status: "rejected" },
          { game_id: "g1", player_id: "u3", status: "withdrawn" },
        ],
      },
    );
    const out = await sendDueGameReminders(admin, { now: NOW });
    expect(notifications.map((n) => [n.user_id, n.link])).toEqual([
      ["u1", "/games/g1"],
      ["u4", "/games/g2"],
    ]);
    expect(pushes().map((p) => [p.userId, p.url])).toEqual([
      ["u1", "/games/g1"],
      ["u4", "/games/g2"],
    ]);
    expect(deleted.sort()).toEqual(["r2", "r3", "r4"]);
    expect(reminders.map((r) => r.id)).toEqual(["r1", "r5"]);
    expect(out).toMatchObject({ sent: 2, removed: 3 });
    // Gone for good: the next run has nothing to look at for them.
    await sendDueGameReminders(admin, { now: NOW + 5 * 60_000 });
    expect(notifications).toHaveLength(2);
  });

  it("keeps a reminder row the player saved again while the run was working (they joined again)", async () => {
    const reminders = [rem("r1", "u1", "g1", [120])];
    const { admin, notifications, deleted } = fakeAdmin(reminders, [game("g1", 100)], {
      roster: [],
      beforeDelete: () => {
        Object.assign(reminders[0], {
          offsets: [1440, 120],
          last_sent_offset: null,
          updated_at: "2026-11-08T12:00:00.5+00:00",
        });
      },
    });
    const out = await sendDueGameReminders(admin, { now: NOW });
    expect(deleted).toEqual([]);
    expect(reminders).toHaveLength(1);
    expect(out.removed).toBe(0);
    expect(notifications).toHaveLength(0);
  });

  it("reads the roster, the open requests and the preferences once per run, for every due player", async () => {
    const reminders = ["u1", "u2", "u3"].flatMap((u, i) => [
      rem(`a${i}`, u, "g1", [120]),
      rem(`b${i}`, u, "g2", [120]),
    ]);
    const { admin, readsOf } = fakeAdmin(reminders, [game("g1", 100), game("g2", 90)]);
    expect((await sendDueGameReminders(admin, { now: NOW })).sent).toBe(6);
    expect(readsOf("game_participants")).toBe(1);
    expect(readsOf("join_requests")).toBe(1);
    expect(readsOf("notification_preferences")).toBe(1);
  });

  it.each([
    ["roster", { failRoster: true }],
    ["join requests", { failRequests: true }],
  ] as const)(
    "sends and deletes nothing when the %s cannot be read; the reminders stay due",
    async (_what, failure) => {
      const reminders = [rem("r1", "u1", "g1", [120]), rem("r2", "u2", "g1", [120])];
      const { admin, notifications, deleted } = fakeAdmin(reminders, [game("g1", 100)], {
        roster: [["g1", "u1"]],
        ...failure,
      });
      await expect(sendDueGameReminders(admin, { now: NOW })).rejects.toThrow(/read failed/);
      expect(notifications).toHaveLength(0);
      expect(pushes()).toHaveLength(0);
      expect(deleted).toEqual([]);
      expect(reminders.map((r) => r.last_sent_offset)).toEqual([null, null]);
    },
  );
});

describe("sendDueGameReminders pushes reminders to phones (P2-7)", () => {
  const dated = (startsIn: number) => formatDatedWhen({ date: inMinutes(startsIn), allDay: false });

  it("pushes each claimed reminder once, to its player, with the title, start time, game link and expiry", async () => {
    const reminders = [
      rem("r1", "u1", "g1", [1440, 120]),
      rem("r2", "u2", "g1", [120]),
      rem("r3", "u3", "g2", [60]), // not due yet
      rem("r4", "u1", "g3", [120]),
    ];
    const { admin, readsOf } = fakeAdmin(reminders, [
      game("g1", 100),
      game("g2", 600),
      game("g3", 90),
    ]);
    expect((await sendDueGameReminders(admin, { now: NOW })).sent).toBe(3);
    // Soonest game first; each push links the in-app notification it mirrors.
    expect(pushes()).toEqual([
      {
        userId: "u1",
        title: "Game g3 starts in 1 hour 30 minutes",
        body: dated(90),
        url: "/games/g3",
        expiresAt: inMinutes(90),
        notificationId: "n1",
      },
      {
        userId: "u1",
        title: "Game g1 starts in 1 hour 40 minutes",
        body: dated(100),
        url: "/games/g1",
        expiresAt: inMinutes(100),
        notificationId: "n2",
      },
      {
        userId: "u2",
        title: "Game g1 starts in 1 hour 40 minutes",
        body: dated(100),
        url: "/games/g1",
        expiresAt: inMinutes(100),
        notificationId: "n3",
      },
    ]);
    // One preferences read for the run, not one per player or per reminder.
    expect(readsOf("notification_preferences")).toBe(1);
  });

  it("never pushes the same reminder twice, even when two runs overlap", async () => {
    const reminders = [rem("r1", "u1", "g1", [120])];
    const { admin } = fakeAdmin(reminders, [game("g1", 100)]);
    await Promise.all([
      sendDueGameReminders(admin, { now: NOW }),
      sendDueGameReminders(admin, { now: NOW }),
    ]);
    await sendDueGameReminders(admin, { now: NOW });
    expect(pushes()).toHaveLength(1);
  });

  it("skips the push for a player who switched game-reminder push off, read as the app reads prefs", async () => {
    const reminders = ["u1", "u2", "u3", "u4"].map((u, i) => rem(`r${i}`, u, "g1", [120]));
    const { admin, notifications } = fakeAdmin(reminders, [game("g1", 100)], {
      prefs: {
        u1: { gameReminders: { inApp: true, push: false } }, // switched off
        u2: { gameReminders: { inApp: false } }, // push not set: on by default
        u3: { approvals: { push: false }, messages: { push: false } }, // legacy and other categories
        // u4: no row at all, so the defaults: on
      },
    });
    await sendDueGameReminders(admin, { now: NOW });
    expect(pushes().map((p) => p.userId)).toEqual(["u2", "u3", "u4"]);
    // Push off only keeps it off the phone: the reminder is still in the app.
    expect(notifications.some((n) => n.user_id === "u1")).toBe(true);
  });

  it("sends no push when the preferences cannot be read, but still writes the reminder", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reminders = [rem("r1", "u1", "g1", [120])];
    const { admin, notifications } = fakeAdmin(reminders, [game("g1", 100)], { failPrefs: true });
    expect((await sendDueGameReminders(admin, { now: NOW })).sent).toBe(1);
    expect(notifications).toHaveLength(1);
    expect(pushes()).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      "[reminders] preferences unavailable; no pushes this run",
      expect.any(Error),
    );
  });

  it("sends no push when the in-app notification cannot be written", async () => {
    const reminders = [rem("r1", "u1", "g1", [120])];
    const { admin } = fakeAdmin(reminders, [game("g1", 100)], { failInsert: true });
    await sendDueGameReminders(admin, { now: NOW });
    expect(pushes()).toHaveLength(0);
  });

  it("sends no push when another caller claimed the reminder first", async () => {
    const reminders = [rem("r1", "u1", "g1", [120])];
    const { admin, notifications } = fakeAdmin(reminders, [game("g1", 100)], {
      // The app's own flush sends it between this run's read and its claim.
      beforeClaim: () => {
        reminders[0].last_sent_offset = 120;
      },
    });
    expect((await sendDueGameReminders(admin, { now: NOW })).sent).toBe(0);
    expect(notifications).toHaveLength(0);
    expect(pushes()).toHaveLength(0);
  });

  it("keeps the venue off the lock screen: the in-app reminder has it, the push does not", async () => {
    const reminders = [rem("r1", "u1", "g1", [120])];
    const { admin, notifications } = fakeAdmin(reminders, [
      game("g1", 100, { location: "Rucker Park, W 155th St" }),
    ]);
    await sendDueGameReminders(admin, { now: NOW });
    const [push] = pushes();
    const when = { date: inMinutes(100), allDay: false };
    expect(notifications[0].body).toBe(
      `${formatNotificationWhen(when)} · Where: Rucker Park, W 155th St`,
    );
    expect(push.body).toBe(formatDatedWhen(when));
    expect(JSON.stringify(push)).not.toMatch(/Rucker|155th|Where/);
  });

  it("names the weekday and date on the lock screen, never Today or Tomorrow, in New York time", async () => {
    // Sunday Nov 8, 7:30 PM in New York (00:30 UTC on the 9th): the server's day is already
    // Monday, so the relative wording said "Today" for a game on Monday evening.
    vi.useFakeTimers({ toFake: ["Date"] });
    const evening = Date.parse("2026-11-09T00:30:00Z");
    vi.setSystemTime(evening);
    const reminders = [rem("r1", "u1", "g1", [1440]), rem("r2", "u1", "g2", [10080])];
    const { admin } = fakeAdmin(reminders, [
      { id: "g1", title: "Run", date: "2026-11-09T23:00:00Z", location: null, all_day: false },
      // An all-day game is stored as midnight in New York.
      { id: "g2", title: "Camp", date: "2026-11-10T05:00:00Z", location: null, all_day: true },
    ]);
    await sendDueGameReminders(admin, { now: evening });
    expect(pushes().map((p) => p.body)).toEqual(["Mon, Nov 9 · 6:00 PM", "Tue, Nov 10 (all day)"]);
    expect(
      pushes()
        .map((p) => p.body)
        .join(),
    ).not.toMatch(/Today|Tomorrow/);
  });

  it("carries on when a push fails: the reminder stays sent and the next player still gets theirs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deliverPush.mockImplementationOnce(async () => {
      throw new Error("provider down");
    });
    const reminders = [rem("r1", "u1", "g1", [120]), rem("r2", "u2", "g1", [120])];
    const { admin } = fakeAdmin(reminders, [game("g1", 100)]);
    expect((await sendDueGameReminders(admin, { now: NOW })).sent).toBe(2);
    expect(pushes().map((p) => p.userId)).toEqual(["u1", "u2"]);
    expect(reminders.map((r) => r.last_sent_offset)).toEqual([120, 120]);
    expect(warn).toHaveBeenCalledWith("[reminders] push failed", expect.any(Error));
  });
});

describe("sendDueGameReminders keeps inside pg_net's 5 seconds (P2-7 review)", () => {
  it("stops claiming once the run is over budget and leaves the rest due for the next run", async () => {
    const reminders = ["u1", "u2", "u3", "u4", "u5"].map((u, i) => rem(`r${i}`, u, "g1", [120]));
    let t = 0;
    const { admin, notifications } = fakeAdmin(reminders, [game("g1", 100)], {
      beforeClaim: () => {
        t += 1000; // each claim takes a second of wall time
      },
    });
    const first = await sendDueGameReminders(admin, { now: NOW, clock: () => t });
    expect(first).toMatchObject({ sent: 3, deferred: 2, pushed: 3 });
    expect(reminders.map((r) => r.last_sent_offset)).toEqual([120, 120, 120, null, null]);

    t = 0;
    const second = await sendDueGameReminders(admin, { now: NOW + 5 * 60_000, clock: () => t });
    expect(second).toMatchObject({ sent: 2, deferred: 0 });
    expect(notifications.map((n) => n.user_id)).toEqual(["u1", "u2", "u3", "u4", "u5"]);
  });

  it("sends the pushes after every in-app row is written, at most 4 at a time", async () => {
    const reminders = Array.from({ length: 10 }, (_, i) => rem(`r${i}`, `u${i}`, "g1", [120]));
    const { admin, notifications } = fakeAdmin(reminders, [game("g1", 100)]);
    let inFlight = 0;
    let most = 0;
    const rowsWritten: number[] = [];
    deliverPush.mockImplementation(async () => {
      rowsWritten.push(notifications.length);
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { ok: true as const, recipients: 1 };
    });
    const out = await sendDueGameReminders(admin, { now: NOW });
    expect(out).toMatchObject({ sent: 10, pushed: 10 });
    expect(pushes()).toHaveLength(10);
    expect(most).toBe(4);
    expect(rowsWritten.every((n) => n === 10)).toBe(true);
  });

  it("takes the soonest games first when more are due than one run takes on", async () => {
    const reminders = [
      rem("r1", "u1", "g1", [60]),
      rem("r2", "u1", "g2", [60]),
      rem("r3", "u1", "g3", [60]),
    ];
    const { admin, notifications } = fakeAdmin(reminders, [
      game("g1", 30),
      game("g2", 20),
      game("g3", 10),
    ]);
    const out = await sendDueGameReminders(admin, { now: NOW, maxDue: 2 });
    expect(notifications.map((n) => n.link)).toEqual(["/games/g3", "/games/g2"]);
    expect(out).toMatchObject({ sent: 2, deferred: 1 });
    expect(reminders[0].last_sent_offset).toBeNull();
  });
});

describe("wiring", () => {
  it("the scheduled endpoint is worker-only and the app's flush uses the same sweep", () => {
    const route = readFileSync("src/routes/api/public/reminders/run.ts", "utf8");
    expect(route).toMatch(/authorizeWorker\(request\)\) !== "ok"/);
    expect(route).toMatch(/sendDueGameReminders\(supabaseAdmin as never\)/);
    const fn = readFileSync("src/lib/game-reminders.functions.ts", "utf8");
    expect(fn).toMatch(
      /sendDueGameReminders\(supabaseAdmin as never, \{\s*userId: context\.userId/,
    );
  });
});

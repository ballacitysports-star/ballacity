import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  dueOffset,
  leadText,
  sendDueGameReminders,
  type ReminderAdmin,
  type ReminderGame,
  type ReminderRow,
} from "./game-reminders.server";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const inMinutes = (m: number) => new Date(NOW + m * 60_000).toISOString();

/** An in-memory admin client for game_reminders, hosted_games and notifications. */
function fakeAdmin(
  reminders: ReminderRow[],
  games: ReminderGame[],
  opts: { failInsert?: boolean } = {},
) {
  const notifications: Record<string, unknown>[] = [];
  const admin: ReminderAdmin = {
    from(table: string) {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      let patch: Record<string, unknown> | null = null;
      const run = () => {
        if (table === "game_reminders") {
          const rows = reminders.filter((r) => filters.every((f) => f(r as never)));
          if (patch) for (const r of rows) Object.assign(r, patch);
          return rows.map((r) => ({ ...r }));
        }
        if (table === "hosted_games")
          return games.filter((g) => filters.every((f) => f(g as never)));
        return [];
      };
      const q: Record<string, unknown> = {
        select: () => q,
        limit: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
        gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), q),
        lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), q),
        or: (f: string) => {
          // only the claim filter is used: last_sent_offset.is.null,last_sent_offset.gt.N
          const n = Number(f.split("gt.")[1]);
          filters.push((r) => r.last_sent_offset == null || Number(r.last_sent_offset) > n);
          return q;
        },
        update: (p: Record<string, unknown>) => ((patch = p), q),
        insert: async (row: Record<string, unknown>) => {
          if (opts.failInsert) return { data: null, error: { message: "boom" } };
          notifications.push(row);
          return { data: null, error: null };
        },
        then: (ok: (r: unknown) => unknown) =>
          Promise.resolve({ data: run(), error: null }).then(ok),
      };
      return q as never;
    },
  };
  return { admin, notifications };
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
});

describe("dueOffset", () => {
  it("picks the largest window that has opened and was not sent", () => {
    expect(dueOffset([1440, 120], null, 100)).toBe(1440);
    expect(dueOffset([1440, 120], 1440, 100)).toBe(120);
    expect(dueOffset([1440, 120], 120, 100)).toBeNull();
    expect(dueOffset([1440, 120], null, 2000)).toBeNull();
    expect(dueOffset([], null, 10)).toBeNull();
  });
  it("words the lead time", () => {
    expect([leadText(30), leadText(60), leadText(120), leadText(1440), leadText(2880)]).toEqual([
      "30 minutes",
      "1 hour",
      "2 hours",
      "1 day",
      "2 days",
    ]);
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
      ["u1", "Game g1 starts in 1 day", "/games/g1"],
      ["u2", "Game g1 starts in 2 hours", "/games/g1"],
    ]);
    expect(reminders.map((r) => r.last_sent_offset)).toEqual([1440, 120, null]);
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

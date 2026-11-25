import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The browser side of a host's removal (20261202100000): the one host_remove_player call both Removes share
 * (hostRemovePlayer, one retry on a deadlock), the viewer's own removal record (getMyGameRemoval; a missing table is
 * "not removed"), and the host's request list, which keeps a removed minor's request to come back although it carries
 * the guardian-only key (withoutGuardianOnly).
 */
type Answer = { data: unknown; error: { code?: string; message?: string } | null };
const env = vi.hoisted(() => ({
  rpcCalls: [] as { fn: string; args: unknown }[],
  rpcAnswers: [] as Answer[],
  tables: {} as Record<string, Answer>,
  reads: [] as { table: string; filters: unknown[] }[],
}));

vi.mock("@/lib/current-user-id", () => ({ getCurrentUserId: async () => "me" }));
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const filters: unknown[] = [];
    env.reads.push({ table, filters });
    const answer = () => env.tables[table] ?? { data: null, error: null };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), b),
      in: (c: string, v: unknown) => (filters.push(["in", c, v]), b),
      maybeSingle: async () => answer(),
      then: (resolve: (a: Answer) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(answer()).then(resolve, reject),
    };
    return b;
  };
  return {
    supabase: {
      rpc: async (fn: string, args: unknown) => {
        env.rpcCalls.push({ fn, args });
        return env.rpcAnswers.shift() ?? { data: { removed: true }, error: null };
      },
      from: builder,
    },
  };
});

const { getMyGameRemoval, hostRemovePlayer, listMyGameRemovals, withoutGuardianOnly } =
  await import("@/lib/payments");
const { PAID_NOT_PLACED_MESSAGE } = await import("@/lib/payments-policy");

beforeEach(() => {
  env.rpcCalls.length = 0;
  env.rpcAnswers = [];
  env.tables = {};
  env.reads.length = 0;
});

const deadlock: Answer = { data: null, error: { code: "40P01", message: "deadlock detected" } };

describe("hostRemovePlayer", () => {
  it("makes one host_remove_player call", async () => {
    await expect(hostRemovePlayer("g1", "p1")).resolves.toBeNull();
    expect(env.rpcCalls).toEqual([
      { fn: "host_remove_player", args: { _game: "g1", _player: "p1" } },
    ]);
  });

  it("tries once more after a deadlock, and only once", async () => {
    env.rpcAnswers = [deadlock];
    await expect(hostRemovePlayer("g1", "p1")).resolves.toBeNull();
    expect(env.rpcCalls).toHaveLength(2);
    env.rpcCalls.length = 0;
    env.rpcAnswers = [deadlock, deadlock];
    await expect(hostRemovePlayer("g1", "p1")).resolves.toMatchObject({ code: "40P01" });
    expect(env.rpcCalls).toHaveLength(2);
  });

  it("hands any other error back without repeating it", async () => {
    env.rpcAnswers = [
      { data: null, error: { code: "42501", message: "NOT_GAME_HOST: only the game's host" } },
    ];
    await expect(hostRemovePlayer("g1", "p1")).resolves.toMatchObject({ code: "42501" });
    expect(env.rpcCalls).toHaveLength(1);
  });
});

describe("getMyGameRemoval", () => {
  it("reads the viewer's own row for the game", async () => {
    env.tables.game_removals = { data: { game_id: "g1" }, error: null };
    await expect(getMyGameRemoval("g1")).resolves.toBe(true);
    expect(env.reads.at(-1)).toEqual({
      table: "game_removals",
      filters: [
        ["eq", "game_id", "g1"],
        ["eq", "user_id", "me"],
      ],
    });
    env.tables.game_removals = { data: null, error: null };
    await expect(getMyGameRemoval("g1")).resolves.toBe(false);
  });

  it("counts a missing table (the migration not applied yet) or a failed read as not removed", async () => {
    env.tables.game_removals = {
      data: null,
      error: { code: "PGRST205", message: "no such table" },
    };
    await expect(getMyGameRemoval("g1")).resolves.toBe(false);
    env.tables.game_removals = { data: null, error: { code: "500", message: "down" } };
    await expect(getMyGameRemoval("g1")).resolves.toBe(false);
  });
});

describe("listMyGameRemovals (the Me tab's request lines)", () => {
  it("answers the games among these the viewer was removed from", async () => {
    env.tables.game_removals = { data: [{ game_id: "g2" }], error: null };
    await expect(listMyGameRemovals(["g1", "g2", "g2"])).resolves.toEqual(new Set(["g2"]));
    expect(env.reads.at(-1)).toEqual({
      table: "game_removals",
      filters: [
        ["eq", "user_id", "me"],
        ["in", "game_id", ["g1", "g2"]],
      ],
    });
  });

  it("answers none for a missing table or a failed read, and reads nothing for no games", async () => {
    env.tables.game_removals = {
      data: null,
      error: { code: "PGRST205", message: "no such table" },
    };
    await expect(listMyGameRemovals(["g1"])).resolves.toEqual(new Set());
    const before = env.reads.length;
    await expect(listMyGameRemovals([])).resolves.toEqual(new Set());
    expect(env.reads).toHaveLength(before);
  });
});

describe("the host's toast after a verified payment that could not be placed", () => {
  it("stays neutral: for a player the host removed the way back is not 'give them a spot'", () => {
    expect(PAID_NOT_PLACED_MESSAGE).not.toMatch(/give them a spot/i);
    expect(PAID_NOT_PLACED_MESSAGE).toMatch(/notice with the reason and what you can do/);
  });
});

describe("withoutGuardianOnly: a removed minor's ask reaches the host", () => {
  const rows = [
    { id: "r1", game_id: "gopen", player_id: "kid", idempotency_key: "guardian-only:gopen" },
    { id: "r2", game_id: "gopen", player_id: "kim", idempotency_key: "guardian-only:gopen" },
    { id: "r3", game_id: "gopen", player_id: "ana", idempotency_key: "join:gopen" },
  ];

  it("leaves out a guardian-only request on an open game, except a removed player's", async () => {
    env.tables.game_payment_settings = {
      data: [{ game_id: "gopen", requires_approval: false }],
      error: null,
    };
    env.tables.game_removals = { data: [{ game_id: "gopen", user_id: "kid" }], error: null };
    const kept = await withoutGuardianOnly(rows);
    expect(kept.map((r) => r.id)).toEqual(["r1", "r3"]);
  });

  it("leaves them all out as before when the removals cannot be read", async () => {
    env.tables.game_payment_settings = {
      data: [{ game_id: "gopen", requires_approval: false }],
      error: null,
    };
    env.tables.game_removals = { data: null, error: { code: "42P01", message: "missing" } };
    expect((await withoutGuardianOnly(rows)).map((r) => r.id)).toEqual(["r3"]);
  });

  it("does not read the removals when nothing is hidden", async () => {
    env.tables.game_payment_settings = {
      data: [{ game_id: "gopen", requires_approval: true }],
      error: null,
    };
    expect((await withoutGuardianOnly(rows)).map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    expect(env.reads.some((r) => r.table === "game_removals")).toBe(false);
  });
});

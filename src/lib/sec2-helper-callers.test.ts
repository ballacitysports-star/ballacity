import { beforeEach, describe, expect, it, vi } from "vitest";

// SEC-2 (migration 20261112150000): the database answers a signed-in client's
// question about another person with a fixed answer (false). The server code
// that needs the real answer about someone else must ask with the service role,
// and only after it has shown the caller has a reason to ask.

// A server function is its handler for these tests: validate, then run with the given context.
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
        return (arg: { data?: unknown; context?: unknown }) =>
          fn({ data: validate(arg?.data), context: arg?.context });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

type Result = { data?: unknown; error: { message: string } | null; count?: number };
const calls: { who: "admin" | "user"; fn: string; args: unknown }[] = [];
const db = {
  rpc: {} as Record<string, unknown>,
  hostId: "host-1" as string | null,
  linked: { game_participants: 0, join_requests: 0, payment_submissions: 0 } as Record<
    string,
    number
  >,
  inserted: [] as { table: string; row: unknown }[],
};

const chain = (result: () => Result) => {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => result();
  c.then = (resolve: (r: Result) => unknown) => resolve(result());
  return c;
};

const rpcFor = (who: "admin" | "user") => async (fn: string, args: unknown) => {
  calls.push({ who, fn, args });
  // A signed-in client asking about anyone but itself gets the fixed answer, as the database gives it.
  // (The host's own gate is always open here; db.rpc decides the service role's answers.)
  if (who === "user" && fn === "game_payments_allowed") {
    return { data: (args as { _user?: string })._user === "host-1", error: null };
  }
  if (who === "user" && fn === "can_notify") return { data: false, error: null };
  return { data: db.rpc[fn] ?? null, error: null };
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (fn: string, args: unknown) => rpcFor("admin")(fn, args),
    from: (table: string) => {
      const c = chain(() => {
        if (table === "hosted_games")
          return { data: db.hostId ? { host_id: db.hostId } : null, error: null };
        return { data: null, error: null, count: db.linked[table] ?? 0 };
      });
      c.insert = async (row: unknown) => {
        db.inserted.push({ table, row });
        return { error: null };
      };
      return c;
    },
  },
}));
vi.mock("@/lib/push.server", () => ({ deliverPush: async () => ({ ok: true as const }) }));

import { createNotificationForUser } from "@/lib/notifications.functions";
import { sendPushToUser } from "@/lib/push.functions";
import { reviewPaymentAction } from "@/lib/payments.functions";

const TARGET = "00000000-0000-4000-8000-000000000002";
const userClient = {
  rpc: (fn: string, args: unknown) => rpcFor("user")(fn, args),
  from: () => {
    const c = chain(() => ({ data: null, error: null }));
    c.insert = () => c;
    c.single = async () => ({ data: null, error: { message: "insert not modelled" } });
    return c;
  },
};
const ctx = (userId: string) => ({ userId, supabase: userClient });

beforeEach(() => {
  calls.length = 0;
  db.rpc = {};
  db.hostId = "host-1";
  db.linked = { game_participants: 0, join_requests: 0, payment_submissions: 0 };
  db.inserted = [];
});

describe("can_notify is asked with the service role", () => {
  it("a cross-user notification goes through when the relationship holds", async () => {
    db.rpc.can_notify = true;
    const res = await createNotificationForUser({
      data: { user_id: TARGET, type: "game", title: "Hi" },
      context: ctx("host-1"),
    } as never);
    expect(res).toEqual({ ok: true });
    expect(calls).toEqual([
      { who: "admin", fn: "can_notify", args: { _caller: "host-1", _target: TARGET } },
    ]);
    expect(db.inserted).toHaveLength(1);
  });

  it("and is refused when it does not", async () => {
    db.rpc.can_notify = false;
    await expect(
      createNotificationForUser({
        data: { user_id: TARGET, type: "game", title: "Hi" },
        context: ctx("host-1"),
      } as never),
    ).rejects.toThrow("Not authorized to notify this user");
    expect(db.inserted).toHaveLength(0);
  });

  it("a push to another user asks the same way, with the session user as _caller", async () => {
    db.rpc.can_notify = true;
    const res = await sendPushToUser({
      data: { userId: TARGET, title: "Hi" },
      context: ctx("host-1"),
    } as never);
    expect(res).toEqual({ ok: true });
    expect(calls).toEqual([
      { who: "admin", fn: "can_notify", args: { _caller: "host-1", _target: TARGET } },
    ]);
    db.rpc.can_notify = false;
    expect(
      await sendPushToUser({
        data: { userId: TARGET, title: "Hi" },
        context: ctx("host-1"),
      } as never),
    ).toEqual({ ok: false, reason: "not_authorized" });
  });
});

describe("reviewPaymentAction asks the player's gate only for its own game's players", () => {
  const review = (userId: string, playerId = "player-1") =>
    reviewPaymentAction({
      data: { gameId: "g1", playerId, next: "verified" },
      context: ctx(userId),
    } as never);

  it("someone who does not host the game is refused before any gate is asked", async () => {
    db.linked.game_participants = 1;
    await expect(review("stranger-9")).rejects.toThrow(
      "Only this game's host can review its payments.",
    );
    expect(calls).toEqual([]);
  });

  it("a host cannot use it to ask about an account that is not part of the game", async () => {
    await expect(review("host-1", "anyone-7")).rejects.toThrow(
      "This player isn't part of this game.",
    );
    expect(calls).toEqual([]);
  });

  it("for a player on the game: the host's own gate with the host's client, the player's with the service role", async () => {
    db.linked.join_requests = 1;
    db.rpc.game_payments_allowed = true;
    // No submission yet, and the mark-paid insert is not modelled: it stops right after the gates.
    await expect(review("host-1")).rejects.toThrow("insert not modelled");
    expect(calls).toEqual([
      { who: "user", fn: "game_payments_allowed", args: { _user: "host-1" } },
      { who: "admin", fn: "game_payments_allowed", args: { _user: "player-1" } },
    ]);
  });

  it("a player whose cohort may not pay is still refused (the real answer, not the fixed one)", async () => {
    db.linked.game_participants = 1;
    db.rpc.game_payments_allowed = false;
    await expect(review("host-1")).rejects.toThrow(
      "Payment coordination isn't available for this player's account yet.",
    );
  });
});

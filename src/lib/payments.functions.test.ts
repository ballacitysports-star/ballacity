/* eslint-disable @typescript-eslint/no-explicit-any -- hand-rolled Supabase stub */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
      handler(fn: (ctx: { data: unknown; context?: unknown }) => unknown) {
        return (arg?: { data?: unknown; context?: unknown }) =>
          fn({ data: validate(arg?.data), context: arg?.context });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const db = {
  gameHost: "teen-host" as string,
  payee: "guardian" as string | null,
  existing: null as Record<string, unknown> | null,
  inserts: [] as { table: string; row: any }[],
  updates: [] as { table: string; patch: any }[],
};

function adminFrom(table: string) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    maybeSingle: async () =>
      table === "hosted_games" ? { data: { host_id: db.gameHost }, error: null } : { data: null },
    then: (resolve: (r: unknown) => unknown) => resolve({ count: 1, error: null }),
  };
  return chain;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: adminFrom,
    rpc: async (fn: string) =>
      fn === "game_payee_id"
        ? { data: db.payee, error: null }
        : fn === "game_payments_allowed"
          ? { data: true, error: null }
          : { data: null, error: null },
  },
}));
vi.mock("./roster-on-payment.server", () => ({
  addPaidPlayerToRoster: vi.fn(async () => ({ added: true })),
}));

function userClient() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: db.existing, error: null }),
    insert: (row: any) => {
      db.inserts.push({ table: "payment_submissions", row });
      return chain;
    },
    update: (patch: any) => {
      db.updates.push({ table: "payment_submissions", patch });
      return chain;
    },
    single: async () => ({ data: null, error: null }),
  };
  return {
    rpc: async () => ({ data: true, error: null }),
    from: () => chain,
  };
}

const { reviewPaymentAction } = await import("./payments.functions");
const review = (userId: string, next: "verified" | "rejected" | "pending" = "verified") =>
  (reviewPaymentAction as any)({
    data: { gameId: "g1", playerId: "player-1", next },
    context: { supabase: userClient(), userId },
  });

beforeEach(() => {
  db.gameHost = "teen-host";
  db.payee = "guardian";
  db.existing = {
    id: "s1",
    status: "pending",
    screenshot_path: null,
    game_id: "g1",
    player_id: "player-1",
    host_id: "guardian",
  };
  db.inserts = [];
  db.updates = [];
});

describe("reviewPaymentAction: who manages a game's payments", () => {
  it("refuses the game's host when the money goes to someone else (a minor host's payment manager)", async () => {
    await expect(review("teen-host")).rejects.toThrow(/Only this game's host/);
    expect(db.updates).toHaveLength(0);
  });

  it("refuses everyone when the game has no payee", async () => {
    db.payee = null;
    db.gameHost = "teen-host";
    await expect(review("teen-host")).rejects.toThrow(/Only this game's host/);
  });

  it("lets the payee review", async () => {
    await expect(review("guardian")).resolves.toMatchObject({ ok: true });
    expect(db.updates[0]?.patch.status).toBe("verified");
  });

  it("lets an adult host who is the payee review", async () => {
    db.gameHost = "adult-host";
    db.payee = "adult-host";
    db.existing = { ...db.existing!, host_id: "adult-host" };
    await expect(review("adult-host")).resolves.toMatchObject({ ok: true });
  });
});

describe("reviewPaymentAction: no 'mark paid' without a submission", () => {
  it("refuses to create a payment the player never submitted", async () => {
    db.existing = null;
    await expect(review("guardian", "verified")).rejects.toThrow(/No payment submission/);
    expect(db.inserts).toHaveLength(0);
  });
});

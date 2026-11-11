/**
 * Audit F03 follow-up: PayPal checkout follows the guardian rule.
 *
 * The server records a PayPal payment with the service role, which the payment
 * trigger lets through (the money has already moved by then). So the server asks,
 * as the player, before creating an order and again before capturing it. Since
 * task #69 the guardian rule is one of the rules paypal_payment_precondition asks
 * (it calls game_payment_guardian_ready), answered as GUARDIAN_APPROVAL_REQUIRED.
 * These run the real server functions with PayPal and the database faked. A server
 * function is its handler here: validate, then run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GUARDIAN_PAYMENT_MESSAGE,
  PAYMENT_CHECK_FAILED_MESSAGE,
  PAYMENTS_BLOCKED_MESSAGE,
  paymentPolicyMessageOf,
} from "./payments-policy";

const PLAYER = "11111111-1111-4111-8111-111111111111";
const HOST = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  guardian: { data: null as unknown, error: null as null | { message: string } },
  playerRpcs: [] as { name: string; args: unknown }[],
  order: null as null | Record<string, unknown>,
  inserted: [] as { table: string; row: unknown }[],
  updated: [] as { table: string; row: unknown }[],
  paypal: { created: 0, looked: 0, captured: 0 },
  rostered: [] as string[],
}));

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
        return (arg: { data: unknown; context: unknown }) =>
          fn({ data: validate(arg.data), context: arg.context });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

vi.mock("@/integrations/supabase/client.server", () => {
  const single = (data: unknown) => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data, error: null }),
    };
    return q;
  };
  return {
    supabaseAdmin: {
      rpc: async (name: string) =>
        name === "game_payee_id" ? { data: HOST, error: null } : { data: null, error: null },
      from: (table: string) => {
        if (table === "hosted_games")
          return single({ title: "Friday run", price: 10, host_id: HOST });
        if (table === "game_payment_settings") return single({ entry_fee: 10 });
        if (table === "host_paypal_accounts") return single({ merchant_id: "HOSTMERCHANT1" });
        return {
          insert: async (row: unknown) => {
            h.inserted.push({ table, row });
            return { error: null };
          },
          update: (row: unknown) => {
            const q = {
              eq: () => q,
              in: () => q,
              select: async () => {
                h.updated.push({ table, row });
                return { data: [{}], error: null };
              },
            };
            return q;
          },
          select: () => {
            const q = {
              eq: () => q,
              limit: () => q,
              maybeSingle: async () => ({ data: { id: "recorded" }, error: null }),
            };
            return q;
          },
        };
      },
    },
  };
});

vi.mock("@/lib/paypal.server", () => {
  const paid = (status: string) => ({
    status,
    amountValue: "10.00",
    currency: "USD",
    payeeMerchantId: "HOSTMERCHANT1",
    captureId: "CAPTURE-1",
    captureStatus: "COMPLETED",
  });
  return {
    createOrder: async () => {
      h.paypal.created += 1;
      return { orderId: "ORDER-1" };
    },
    getOrder: async () => {
      h.paypal.looked += 1;
      // An approved order lists no capture yet.
      return { ...paid("APPROVED"), captureId: null, captureStatus: null };
    },
    captureOrder: async () => {
      h.paypal.captured += 1;
      return paid("COMPLETED");
    },
    paypalPaymentMatches: () => true,
  };
});

vi.mock("./roster-on-payment.server", () => ({
  addPaidPlayerToRoster: async (_game: string, player: string) => {
    h.rostered.push(player);
    return { added: true };
  },
}));

/** The player's own client (the request's JWT): RLS and auth.uid() apply. */
function playerClient() {
  const q = (data: unknown) => {
    const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data, error: null }) };
    return b;
  };
  return {
    rpc: async (name: string, args: unknown) => {
      h.playerRpcs.push({ name, args });
      if (name === "paypal_payment_precondition") return h.guardian;
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from: (table: string) => (table === "paypal_orders" ? q(h.order) : q({ id: "g1" })),
  };
}

const { createGamePayPalOrder, captureGamePayPalOrder } = await import("./paypal.functions");
type Call<T> = (arg: { data: T; context: unknown }) => Promise<unknown>;
const createOrderFn = createGamePayPalOrder as unknown as Call<{ gameId: string }>;
const captureFn = captureGamePayPalOrder as unknown as Call<{ orderId: string }>;
const context = () => ({ userId: PLAYER, supabase: playerClient() });

beforeEach(() => {
  h.guardian = { data: null, error: null };
  h.playerRpcs = [];
  h.order = {
    order_id: "ORDER-1",
    game_id: "g-order",
    player_id: PLAYER,
    host_id: HOST,
    amount_cents: 1000,
    currency: "USD",
    status: "created",
  };
  h.inserted = [];
  h.updated = [];
  h.paypal = { created: 0, looked: 0, captured: 0 };
  h.rostered = [];
});

const payments = () => h.inserted.filter((i) => i.table === "payment_submissions");

describe("starting a PayPal checkout", () => {
  it("refuses a player who still needs a guardian's approval, before PayPal is asked", async () => {
    h.guardian = { data: "GUARDIAN_APPROVAL_REQUIRED", error: null };
    await expect(createOrderFn({ data: { gameId: "g1" }, context: context() })).rejects.toThrow(
      GUARDIAN_PAYMENT_MESSAGE,
    );
    expect(h.paypal.created).toBe(0);
    expect(h.inserted).toEqual([]);
  });

  it("asks as the player, for this game", async () => {
    await createOrderFn({ data: { gameId: "g1" }, context: context() });
    expect(h.playerRpcs).toContainEqual({
      name: "paypal_payment_precondition",
      args: { _game_id: "g1" },
    });
  });

  it("fails closed when the check itself fails", async () => {
    h.guardian = { data: null, error: { message: "timeout" } };
    await expect(createOrderFn({ data: { gameId: "g1" }, context: context() })).rejects.toThrow(
      PAYMENT_CHECK_FAILED_MESSAGE,
    );
    expect(h.paypal.created).toBe(0);
  });

  it("starts the checkout when the rule allows it", async () => {
    await expect(createOrderFn({ data: { gameId: "g1" }, context: context() })).resolves.toEqual({
      orderId: "ORDER-1",
    });
    expect(h.paypal.created).toBe(1);
    expect(h.inserted.map((i) => i.table)).toEqual(["paypal_orders"]);
  });
});

describe("capturing an approved PayPal order", () => {
  it("does not move the money once the approval is gone (declined, guardian removed or suspended)", async () => {
    h.guardian = { data: "GUARDIAN_APPROVAL_REQUIRED", error: null };
    await expect(captureFn({ data: { orderId: "ORDER-1" }, context: context() })).rejects.toThrow(
      GUARDIAN_PAYMENT_MESSAGE,
    );
    // Asked right before the capture (task #69), after PayPal's read-only order lookup.
    expect(h.paypal.captured).toBe(0);
    expect(payments()).toEqual([]);
    expect(h.rostered).toEqual([]);
  });

  it("fails closed when the check itself fails", async () => {
    h.guardian = { data: null, error: { message: "timeout" } };
    await expect(captureFn({ data: { orderId: "ORDER-1" }, context: context() })).rejects.toThrow(
      PAYMENT_CHECK_FAILED_MESSAGE,
    );
    expect(h.paypal.captured).toBe(0);
    expect(payments()).toEqual([]);
  });

  it("captures and records the payment when the rule allows it, asking about the order's own game", async () => {
    await expect(captureFn({ data: { orderId: "ORDER-1" }, context: context() })).resolves.toEqual({
      ok: true,
      already: false,
      rostered: true,
    });
    expect(h.playerRpcs).toEqual([
      { name: "paypal_payment_precondition", args: { _game_id: "g-order" } },
    ]);
    expect(h.paypal.captured).toBe(1);
    expect(payments()).toHaveLength(1);
    expect(h.rostered).toEqual([PLAYER]);
  });

  it("an order already captured is not asked about again", async () => {
    h.order = { ...h.order, status: "captured" };
    h.guardian = { data: "GUARDIAN_APPROVAL_REQUIRED", error: null };
    await expect(captureFn({ data: { orderId: "ORDER-1" }, context: context() })).resolves.toEqual({
      ok: true,
      already: true,
      rostered: null,
    });
    expect(h.paypal.captured).toBe(0);
  });
});

describe("paymentPolicyMessageOf", () => {
  it("passes on the messages written for the player", () => {
    expect(paymentPolicyMessageOf(new Error(GUARDIAN_PAYMENT_MESSAGE))).toBe(
      GUARDIAN_PAYMENT_MESSAGE,
    );
    expect(paymentPolicyMessageOf(new Error(PAYMENTS_BLOCKED_MESSAGE))).toBe(
      PAYMENTS_BLOCKED_MESSAGE,
    );
  });

  it("holds back anything else, such as a PayPal API error", () => {
    expect(paymentPolicyMessageOf(new Error("PayPal order failed (422)."))).toBeNull();
    expect(paymentPolicyMessageOf("GUARDIAN")).toBeNull();
    expect(paymentPolicyMessageOf(null)).toBeNull();
  });
});

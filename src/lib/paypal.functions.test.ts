/* eslint-disable @typescript-eslint/no-explicit-any -- hand-rolled Supabase and PayPal stubs */
import { beforeEach, describe, expect, it, vi } from "vitest";

// A server function is its handler for these tests: validate the input, then run it with the given context.
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
  precondition: null as string | null,
  preconditionError: null as { message: string } | null,
  payee: "payee-1" as string | null,
  insertError: null as { message: string; code?: string } | null,
  claimRows: [{ order_id: "ORDER-1" }] as unknown[],
  orderRow: null as Record<string, unknown> | null,
  /** errors returned by successive conditional writes (null: none) */
  writeErrors: [] as ({ message: string } | null)[],
  /** a payment already recorded for the order (re-read after an insert error) */
  recordedPayment: null as Record<string, unknown> | null,
  inserts: [] as { table: string; row: any }[],
  updates: [] as { table: string; patch: any }[],
  rpcCalls: [] as { fn: string; args: any }[],
};

function adminFrom(table: string) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      if (table === "hosted_games")
        return { data: { title: "Run", price: 10, host_id: "payee-1" } };
      if (table === "game_payment_settings") return { data: { entry_fee: 10 } };
      if (table === "host_paypal_accounts") return { data: { merchant_id: "MERCH" } };
      // the claim re-read before a refund: still held by this call
      if (table === "paypal_orders") return { data: { order_id: "ORDER-1" }, error: null };
      if (table === "payment_submissions") return { data: db.recordedPayment, error: null };
      return { data: null };
    },
    insert: async (row: any) => {
      db.inserts.push({ table, row });
      return { error: table === "payment_submissions" ? db.insertError : null };
    },
    update: (patch: any) => {
      db.updates.push({ table, patch });
      // chainable and awaitable: .eq().in().select() claims, a bare .eq() just updates
      const u: any = {
        eq: () => u,
        in: () => u,
        select: async () => {
          const error = db.writeErrors.length ? db.writeErrors.shift() : null;
          return error ? { data: null, error } : { data: db.claimRows, error: null };
        },
        then: (resolve: (v: unknown) => void) => resolve({ error: null }),
      };
      return u;
    },
  };
  return chain;
}

const supabaseAdmin = {
  from: adminFrom,
  rpc: async (fn: string, args: any) => {
    db.rpcCalls.push({ fn, args });
    if (fn === "game_payee_id") return { data: db.payee, error: null };
    if (fn === "payment_precondition_error") {
      return { data: db.precondition, error: db.preconditionError };
    }
    return { data: null, error: null };
  },
};
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

const paypal = {
  createOrder: vi.fn(async () => ({ orderId: "ORDER-1" })),
  getOrder: vi.fn(async () => ({
    status: "APPROVED",
    amountValue: "10.00",
    currency: "USD",
    payeeMerchantId: "MERCH",
  })),
  captureOrder: vi.fn(async (): Promise<any> => ({
    status: "COMPLETED",
    orderStatus: "COMPLETED",
    captureId: "CAP-1",
    amountValue: "10.00",
    currency: "USD",
    payeeMerchantId: "MERCH",
    statusReason: null,
  })),
  refundCapture: vi.fn(async () => ({ refundId: "REF-1" })),
};
vi.mock("@/lib/paypal.server", async () => {
  const actual = await vi.importActual<typeof import("./paypal.server")>("./paypal.server");
  return {
    ...paypal,
    paypalPaymentMatches: actual.paypalPaymentMatches,
    parseCaptureResponse: actual.parseCaptureResponse,
  };
});
vi.mock("./roster-on-payment.server", () => ({
  addPaidPlayerToRoster: vi.fn(async () => ({ added: true })),
}));

const { createGamePayPalOrder, captureGamePayPalOrder, getPayPalCheckoutConfig } =
  await import("./paypal.functions");
const paypalActual = await vi.importActual<typeof import("./paypal.server")>("./paypal.server");

/** The player's own (row-security) client: visible game, their own order row, and the merchant-id RPC. */
type UserRpc = (fn: string, args: any) => Promise<{ data: unknown }>;
function userClient(
  userRpc: UserRpc = vi.fn<UserRpc>(async () => ({ data: [{ merchant_id: "MERCH" }] })),
) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: db.orderRow ?? { id: "g1" } }),
  };
  return {
    rpc: async (fn: string, args: any) => {
      if (fn === "game_payments_allowed") return { data: true };
      return userRpc(fn, args);
    },
    from: () => chain,
    userRpc,
  };
}

const order = {
  order_id: "ORDER-1",
  game_id: "g1",
  player_id: "player-1",
  host_id: "payee-1",
  amount_cents: 1000,
  currency: "USD",
  status: "created",
};

beforeEach(() => {
  db.precondition = null;
  db.preconditionError = null;
  db.payee = "payee-1";
  db.insertError = null;
  db.claimRows = [{ order_id: "ORDER-1" }];
  db.orderRow = null;
  db.writeErrors = [];
  db.recordedPayment = null;
  db.inserts = [];
  db.updates = [];
  db.rpcCalls = [];
  for (const f of Object.values(paypal)) f.mockClear();
  paypal.captureOrder.mockImplementation(async () => ({
    status: "COMPLETED",
    orderStatus: "COMPLETED",
    captureId: "CAP-1",
    amountValue: "10.00",
    currency: "USD",
    payeeMerchantId: "MERCH",
    statusReason: null,
  }));
  paypal.refundCapture.mockImplementation(async () => ({ refundId: "REF-1" }));
  process.env.PAYPAL_CLIENT_ID = "client-id";
});

describe("createGamePayPalOrder", () => {
  const create = (userId = "player-1") =>
    (createGamePayPalOrder as any)({
      data: { gameId: "g1" },
      context: { supabase: userClient(), userId },
    });

  it("refuses before creating an order when the host has not approved the request", async () => {
    db.precondition = "HOST_APPROVAL_REQUIRED";
    await expect(create()).rejects.toThrow(/host has to approve/);
    expect(paypal.createOrder).not.toHaveBeenCalled();
    expect(db.rpcCalls).toContainEqual({
      fn: "payment_precondition_error",
      args: { _game_id: "g1", _player: "player-1" },
    });
  });

  it("refuses when a guardian has not approved the game", async () => {
    db.precondition = "GUARDIAN_APPROVAL_REQUIRED";
    await expect(create()).rejects.toThrow(/parent or guardian/);
    expect(paypal.createOrder).not.toHaveBeenCalled();
  });

  it("fails closed when the check itself errors", async () => {
    db.preconditionError = { message: "boom" };
    await expect(create()).rejects.toThrow(/unavailable/);
    expect(paypal.createOrder).not.toHaveBeenCalled();
  });

  it("creates the order when every precondition holds", async () => {
    await expect(create()).resolves.toEqual({ orderId: "ORDER-1" });
    expect(paypal.createOrder).toHaveBeenCalledTimes(1);
    expect(db.inserts.find((i) => i.table === "paypal_orders")?.row.host_id).toBe("payee-1");
  });
});

describe("captureGamePayPalOrder", () => {
  const capture = () =>
    (captureGamePayPalOrder as any)({
      data: { orderId: "ORDER-1" },
      context: { supabase: userClient(), userId: "player-1" },
    });

  beforeEach(() => {
    db.orderRow = { ...order };
  });

  it("re-checks approval for the order's player and does not capture when it no longer holds", async () => {
    db.precondition = "GUARDIAN_APPROVAL_REQUIRED";
    await expect(capture()).rejects.toThrow(/weren't charged/);
    expect(paypal.captureOrder).not.toHaveBeenCalled();
    expect(db.rpcCalls).toContainEqual({
      fn: "payment_precondition_error",
      args: { _game_id: "g1", _player: "player-1" },
    });
    expect(db.updates).toContainEqual({ table: "paypal_orders", patch: { status: "failed" } });
    expect(db.inserts.some((i) => i.table === "payment_submissions")).toBe(false);
  });

  it("does not capture an order that already failed", async () => {
    db.orderRow = { ...order, status: "failed" };
    await expect(capture()).rejects.toThrow(/can't be completed/);
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it("refunds and reports failure when the captured payment cannot be recorded", async () => {
    db.insertError = { message: "GUARDIAN_APPROVAL_REQUIRED" };
    await expect(capture()).rejects.toThrow(/refunding/);
    expect(paypal.refundCapture).toHaveBeenCalledWith("CAP-1");
    const statuses = db.updates
      .filter((u) => u.table === "paypal_orders")
      .map((u) => u.patch.status);
    expect(statuses).toContain("refunded");
    expect(statuses).not.toContain("captured");
  });

  // Independent review of 8b8cc27b.
  it("does not refund when the insert error hid a payment that was recorded", async () => {
    db.insertError = { message: "fetch failed" };
    db.recordedPayment = { id: "pay-1" };
    await expect(capture()).resolves.toEqual({ ok: true, already: true });
    expect(paypal.refundCapture).not.toHaveBeenCalled();
  });

  it("reports pending, not a refund or success, when the order cannot be written", async () => {
    db.writeErrors = [null, { message: "connection reset" }]; // the claim succeeds; storing the capture fails
    await expect(capture()).resolves.toEqual({ ok: false, pending: true });
    expect(paypal.refundCapture).not.toHaveBeenCalled();
    expect(db.inserts.some((i) => i.table === "payment_submissions")).toBe(false);
  });

  it("marks the order unrecorded when the refund also fails, and still does not report success", async () => {
    db.insertError = { message: "Host approval required" };
    paypal.refundCapture.mockImplementation(async () => {
      throw new Error("refund down");
    });
    await expect(capture()).rejects.toThrow(/contact support/);
    const statuses = db.updates
      .filter((u) => u.table === "paypal_orders")
      .map((u) => u.patch.status);
    expect(statuses).toContain("unrecorded");
    expect(statuses).not.toContain("captured");
  });

  it("records a verified payment and reports success when everything holds", async () => {
    await expect(capture()).resolves.toEqual({ ok: true, already: false });
    expect(paypal.captureOrder).toHaveBeenCalledTimes(1);
    const sub = db.inserts.find((i) => i.table === "payment_submissions")?.row;
    expect(sub).toMatchObject({ player_id: "player-1", game_id: "g1", status: "verified" });
    expect(paypal.refundCapture).not.toHaveBeenCalled();
  });
});

describe("captureGamePayPalOrder: capture state (F04)", () => {
  const capture = () =>
    (captureGamePayPalOrder as any)({
      data: { orderId: "ORDER-1" },
      context: { supabase: userClient(), userId: "player-1" },
    });
  const { parseCaptureResponse } = paypalActual;
  const respond = (json: unknown) =>
    paypal.captureOrder.mockImplementation(async () => parseCaptureResponse(json));
  const unit = (captures: unknown[]) => ({
    status: "COMPLETED",
    purchase_units: [{ payee: { merchant_id: "MERCH" }, payments: { captures } }],
  });
  const cap = (status: string, extra: Record<string, unknown> = {}) => ({
    id: "CAP-1",
    status,
    amount: { value: "10.00", currency_code: "USD" },
    ...extra,
  });
  const orderStatuses = () =>
    db.updates.filter((u) => u.table === "paypal_orders").map((u) => u.patch.status);
  const verifiedInserts = () =>
    db.inserts.filter((i) => i.table === "payment_submissions" && i.row.status === "verified");

  beforeEach(() => {
    db.orderRow = { ...order };
  });

  it("the audit case: an order COMPLETED with its capture PENDING is not a verified payment", async () => {
    respond({
      status: "COMPLETED",
      purchase_units: [
        {
          payee: { merchant_id: "MERCH" },
          payments: {
            captures: [
              { id: "C", status: "PENDING", amount: { value: "10.00", currency_code: "USD" } },
            ],
          },
        },
      ],
    });
    await expect(capture()).resolves.toEqual({ ok: false, pending: true });
    expect(verifiedInserts()).toHaveLength(0);
    const parked = db.updates.find(
      (u) => u.table === "paypal_orders" && u.patch.status === "capture_pending",
    );
    expect(parked?.patch).toMatchObject({
      capture_id: "C",
      capture_status: "PENDING",
      paypal_order_status: "COMPLETED",
    });
    expect(paypal.refundCapture).not.toHaveBeenCalled();
  });

  it.each(["DECLINED", "FAILED"])(
    "a %s capture fails the order and records nothing",
    async (status) => {
      respond(unit([cap(status)]));
      await expect(capture()).rejects.toThrow(/could not be verified/);
      expect(verifiedInserts()).toHaveLength(0);
      expect(orderStatuses()).toContain("failed");
      expect(paypal.refundCapture).not.toHaveBeenCalled();
    },
  );

  it("a response with no capture, or with two, is not a payment", async () => {
    respond(unit([]));
    await expect(capture()).rejects.toThrow(/could not be verified/);
    respond(unit([cap("COMPLETED"), cap("COMPLETED", { id: "CAP-2" })]));
    db.orderRow = { ...order };
    await expect(capture()).rejects.toThrow(/could not be verified/);
    expect(verifiedInserts()).toHaveLength(0);
  });

  it.each([
    ["a different amount", { amount: { value: "9.99", currency_code: "USD" } }],
    ["a different currency", { amount: { value: "10.00", currency_code: "EUR" } }],
    ["a different payee", { payee: { merchant_id: "SOMEONE-ELSE" } }],
  ])("a COMPLETED capture with %s is refunded, never verified", async (_l, extra) => {
    respond(unit([cap("COMPLETED", extra)]));
    await expect(capture()).rejects.toThrow(/refunded/);
    expect(paypal.refundCapture).toHaveBeenCalledWith("CAP-1");
    expect(verifiedInserts()).toHaveLength(0);
    expect(orderStatuses()).toContain("refunded");
  });

  it("a COMPLETED, matching capture is stored on the order before the payment, and the payment names it", async () => {
    respond(unit([cap("COMPLETED")]));
    await expect(capture()).resolves.toEqual({ ok: true, already: false });
    const stored = db.updates.find(
      (u) => u.table === "paypal_orders" && u.patch.capture_status === "COMPLETED",
    );
    expect(stored?.patch).toMatchObject({
      capture_id: "CAP-1",
      capture_amount_cents: 1000,
      capture_currency: "USD",
      capture_payee_merchant_id: "MERCH",
    });
    const firstCaptureUpdate = db.updates.indexOf(stored!);
    expect(firstCaptureUpdate).toBeGreaterThanOrEqual(0);
    expect(verifiedInserts()).toHaveLength(1);
    expect(verifiedInserts()[0].row).toMatchObject({
      transaction_reference: "CAP-1",
      paypal_order_id: "ORDER-1",
    });
    expect(orderStatuses().at(-1)).toBe("captured");
  });

  it("a retry after success does not capture again", async () => {
    db.orderRow = { ...order, status: "captured" };
    await expect(capture()).resolves.toEqual({ ok: true, already: true });
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it("a concurrent or duplicate call that loses the claim does not capture", async () => {
    db.claimRows = [];
    await expect(capture()).resolves.toEqual({ ok: false, pending: true });
    expect(paypal.captureOrder).not.toHaveBeenCalled();
    expect(db.inserts).toHaveLength(0);
  });

  it("a call for an order another call is capturing, or that is pending, grants nothing", async () => {
    for (const status of ["capturing", "capture_pending"]) {
      db.orderRow = { ...order, status };
      await expect(capture()).resolves.toEqual({ ok: false, pending: true });
    }
    expect(paypal.captureOrder).not.toHaveBeenCalled();
  });

  it("a duplicate record of the same capture is not refunded and not counted twice", async () => {
    respond(unit([cap("COMPLETED")]));
    db.insertError = { message: "duplicate key", code: "23505" };
    await expect(capture()).resolves.toEqual({ ok: true, already: true });
    expect(paypal.refundCapture).not.toHaveBeenCalled();
  });

  it("when the capture call itself fails the outcome is unknown: nothing is granted or marked failed", async () => {
    paypal.captureOrder.mockImplementation(async () => {
      throw new Error("socket hang up");
    });
    await expect(capture()).rejects.toThrow(/couldn't confirm/);
    expect(db.inserts).toHaveLength(0);
    expect(orderStatuses()).toEqual(["capturing"]);
  });
});

describe("getPayPalCheckoutConfig", () => {
  it("asks the database as the signed-in caller, so it decides who may see the merchant id", async () => {
    const userRpc = vi.fn<UserRpc>(async () => ({ data: [] }));
    const res = await (getPayPalCheckoutConfig as any)({
      data: { gameId: "g1" },
      context: { supabase: userClient(userRpc), userId: "stranger" },
    });
    expect(userRpc).toHaveBeenCalledWith("get_game_host_paypal", { _game_id: "g1" });
    expect(res).toEqual({ clientId: "client-id", merchantId: null });
    expect(db.rpcCalls.some((c) => c.fn === "get_game_host_paypal")).toBe(false);
  });
});

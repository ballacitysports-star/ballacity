/**
 * Task #69: PayPal checkout checks every payment rule before any money moves, and never loses a captured payment.
 *
 * These run the real server functions with PayPal and the database faked. A server function is its handler here:
 * validate, then run. The fake database keeps paypal_orders and payment_submissions in memory and applies an update
 * only to rows that still match its filters, as PostgREST does, so two requests for one order can race.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAPTURE_DECLINED_MESSAGE,
  CAPTURE_IN_PROGRESS_MESSAGE,
  CAPTURE_PENDING_MESSAGE,
  CAPTURE_UNCONFIRMED_MESSAGE,
  ORDER_NOT_CAPTURABLE_MESSAGE,
  PAYMENT_CHECK_FAILED_MESSAGE,
  PAYMENT_POLICY_MESSAGES,
  PAYMENT_PRECONDITION_MESSAGES,
  PAYMENT_REFUNDED_MESSAGE,
  PAYMENT_REFUSED_MESSAGE,
  PAYMENT_TOO_LARGE_MESSAGE,
  PAYMENT_UNRECORDED_MESSAGE,
  PAYPAL_MISMATCH_MESSAGE,
  PAYPAL_UNAVAILABLE_MESSAGE,
  paymentPolicyMessageOf,
} from "./payments-policy";

const PLAYER = "11111111-1111-4111-8111-111111111111";
const HOST = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;
type Details = {
  status: string;
  amountValue: string | null;
  currency: string | null;
  payeeMerchantId: string | null;
  captureId: string | null;
  captureStatus: string | null;
};
const details = (status: string, captureId: string | null = null): Details => ({
  status,
  amountValue: "10.00",
  currency: "USD",
  payeeMerchantId: "HOSTMERCHANT1",
  captureId,
  captureStatus: captureId ? "COMPLETED" : null,
});

const h = vi.hoisted(() => ({
  precondition: { data: null as unknown, error: null as null | { message: string } },
  /** When set, answers paypal_payment_precondition instead of `precondition` (n = the call's number). */
  preconditionFn: null as null | ((n: number) => Promise<{ data: unknown; error: unknown }>),
  preconditionCalls: 0,
  /** Runs inside a payment_submissions lookup, after its rows were read and before they are returned. */
  lookupHook: null as null | ((n: number) => Promise<void>),
  lookups: 0,
  playerRpcs: [] as { name: string; args: unknown }[],
  adminRpcs: [] as string[],
  fee: 10,
  orders: new Map<string, Row>(),
  submissions: [] as Row[],
  insertError: {} as Record<string, { message: string } | undefined>,
  updateError: null as null | { message: string },
  notifications: 0,
  paypal: { created: 0, looked: 0, captured: 0, refunded: [] as string[] },
  getOrder: null as null | ((n: number) => Promise<unknown>),
  createOrder: null as null | (() => Promise<unknown>),
  captureOrder: null as null | (() => Promise<unknown>),
  refund: null as null | (() => Promise<unknown>),
  rostered: [] as string[],
  reports: [] as string[],
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
  const tick = () => new Promise((r) => setTimeout(r, 0));
  /**
   * update(patch).eq(..).eq/in(..).select(): changes only the rows still matching, returns them. Like the partial
   * unique index paypal_orders_one_capture_per_player_game (20261111140000), a player's second order for one game
   * cannot be 'capturing' while another is.
   */
  const updater = (rows: () => Row[], patch: Row) => {
    const filters: ((r: Row) => boolean)[] = [];
    const run = async () => {
      await tick();
      if (h.updateError) return { data: null, error: h.updateError };
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (patch.status === "capturing") {
        const clash = hit.some((r) =>
          rows().some(
            (o) =>
              !hit.includes(o) &&
              o.status === "capturing" &&
              o.game_id === r.game_id &&
              o.player_id === r.player_id,
          ),
        );
        if (clash) return { data: null, error: { code: "23505", message: "duplicate key value" } };
      }
      for (const r of hit) Object.assign(r, patch);
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const q = {
      eq(col: string, v: unknown) {
        filters.push((r) => r[col] === v);
        return q;
      },
      in(col: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[col]));
        return q;
      },
      select: () => run(),
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => run().then(ok, bad),
    };
    return q;
  };
  const finder = (table: string, rows: () => Row[]) => {
    const filters: ((r: Row) => boolean)[] = [];
    const q = {
      select: () => q,
      eq(col: string, v: unknown) {
        filters.push((r) => r[col] === v);
        return q;
      },
      limit: () => q,
      maybeSingle: async () => {
        const data = rows().find((r) => filters.every((f) => f(r))) ?? null;
        if (table === "payment_submissions") {
          h.lookups += 1;
          if (h.lookupHook) await h.lookupHook(h.lookups);
        }
        return { data, error: null };
      },
    };
    return q;
  };
  return {
    supabaseAdmin: {
      rpc: async (name: string) => {
        h.adminRpcs.push(name);
        return name === "game_payee_id" ? { data: HOST, error: null } : { data: null, error: null };
      },
      from: (table: string) => {
        if (table === "hosted_games")
          return single({ title: "Friday run", price: h.fee, host_id: HOST });
        if (table === "game_payment_settings") return single({ entry_fee: h.fee });
        if (table === "host_paypal_accounts") return single({ merchant_id: "HOSTMERCHANT1" });
        const rows = () =>
          table === "paypal_orders"
            ? [...h.orders.values()]
            : table === "payment_submissions"
              ? h.submissions
              : [];
        return {
          ...finder(table, rows),
          insert: async (row: Row) => {
            await tick();
            const err = h.insertError[table];
            if (err) return { error: err };
            if (table === "paypal_orders") h.orders.set(String(row.order_id), { ...row });
            if (table === "payment_submissions") h.submissions.push({ ...row });
            if (table === "notifications") h.notifications += 1;
            return { error: null };
          },
          update: (patch: Row) => updater(rows, patch),
        };
      },
    },
  };
});

vi.mock("@/lib/paypal.server", async () => {
  const actual = await vi.importActual<typeof import("./paypal.server")>("./paypal.server");
  return {
    paypalPaymentMatches: actual.paypalPaymentMatches,
    createOrder: async () => {
      h.paypal.created += 1;
      return h.createOrder ? h.createOrder() : { orderId: "ORDER-1" };
    },
    getOrder: async () => {
      h.paypal.looked += 1;
      return h.getOrder ? h.getOrder(h.paypal.looked) : details("APPROVED");
    },
    captureOrder: async () => {
      h.paypal.captured += 1;
      return h.captureOrder ? h.captureOrder() : details("COMPLETED", "CAPTURE-1");
    },
    refundCapture: async (captureId: string) => {
      h.paypal.refunded.push(captureId);
      return h.refund ? h.refund() : { refundId: "REFUND-1", status: "COMPLETED" };
    },
  };
});

vi.mock("./roster-on-payment.server", () => ({
  addPaidPlayerToRoster: async (_game: string, player: string) => {
    h.rostered.push(player);
    return { added: true };
  },
}));

vi.mock("@/lib/error-report.server", () => ({
  saveErrorReport: async (report: { message: string }) => {
    h.reports.push(report.message);
    return true;
  },
}));

/** The player's own client (the request's JWT): RLS and auth.uid() apply. */
function playerClient() {
  return {
    rpc: async (name: string, args: unknown) => {
      h.playerRpcs.push({ name, args });
      if (name === "paypal_payment_precondition") {
        h.preconditionCalls += 1;
        return h.preconditionFn ? h.preconditionFn(h.preconditionCalls) : h.precondition;
      }
      // #397's separate checks, answered "allowed" so a run against that code shows what it lacks.
      if (name === "game_payments_allowed" || name === "game_payment_guardian_ready")
        return { data: true, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from: (table: string) => {
      let orderId = "ORDER-1";
      const q = {
        select: () => q,
        eq: (col: string, v: string) => {
          if (col === "order_id") orderId = v;
          return q;
        },
        maybeSingle: async () => {
          if (table !== "paypal_orders") return { data: { id: "g1" }, error: null };
          const o = h.orders.get(orderId);
          return { data: o ? { ...o } : null, error: null };
        },
      };
      return q;
    },
  };
}

const { createGamePayPalOrder, captureGamePayPalOrder } = await import("./paypal.functions");
type Call<T> = (arg: { data: T; context: unknown }) => Promise<unknown>;
const createOrderFn = createGamePayPalOrder as unknown as Call<{ gameId: string }>;
const captureFn = captureGamePayPalOrder as unknown as Call<{ orderId: string }>;
const context = () => ({ userId: PLAYER, supabase: playerClient() });
const capture = (orderId = "ORDER-1") => captureFn({ data: { orderId }, context: context() });
const start = () => createOrderFn({ data: { gameId: "g1" }, context: context() });
const order = () => h.orders.get("ORDER-1")!;

function seedOrder(patch: Row = {}, orderId = "ORDER-1") {
  h.orders.set(orderId, {
    order_id: orderId,
    game_id: "g-order",
    player_id: PLAYER,
    host_id: HOST,
    amount_cents: 1000,
    currency: "USD",
    status: "created",
    capture_id: null,
    ...patch,
  });
}

beforeEach(() => {
  h.precondition = { data: null, error: null };
  h.preconditionFn = null;
  h.preconditionCalls = 0;
  h.lookupHook = null;
  h.lookups = 0;
  h.createOrder = null;
  h.playerRpcs = [];
  h.adminRpcs = [];
  h.fee = 10;
  h.orders = new Map();
  seedOrder();
  h.submissions = [];
  h.insertError = {};
  h.updateError = null;
  h.notifications = 0;
  h.paypal = { created: 0, looked: 0, captured: 0, refunded: [] };
  h.getOrder = null;
  h.captureOrder = null;
  h.refund = null;
  h.rostered = [];
  h.reports = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("starting a PayPal checkout", () => {
  it.each(Object.entries(PAYMENT_PRECONDITION_MESSAGES))(
    "refuses %s before PayPal is asked, with the player's message",
    async (code, message) => {
      h.orders.clear();
      h.precondition = { data: code, error: null };
      await expect(start()).rejects.toThrow(message);
      expect(h.paypal.created).toBe(0);
      expect(h.orders.size).toBe(0);
    },
  );

  it("asks as the player, for this game, before reading anything with server privileges", async () => {
    h.precondition = { data: "HOST_APPROVAL_REQUIRED", error: null };
    await expect(start()).rejects.toThrow();
    expect(h.playerRpcs).toEqual([
      { name: "paypal_payment_precondition", args: { _game_id: "g1" } },
    ]);
    expect(h.adminRpcs).toEqual([]);
  });

  it("fails closed when the check itself fails", async () => {
    h.precondition = { data: null, error: { message: "timeout" } };
    await expect(start()).rejects.toThrow(PAYMENT_CHECK_FAILED_MESSAGE);
    expect(h.paypal.created).toBe(0);
  });

  it.each([
    ["an unknown code", "SOMETHING_NEW"],
    ["true", true],
    ["no answer at all", undefined],
  ])("fails closed on an unexpected answer: %s", async (_label, data) => {
    h.precondition = { data, error: null };
    await expect(start()).rejects.toThrow(PAYMENT_REFUSED_MESSAGE);
    expect(h.paypal.created).toBe(0);
  });

  it("refuses a fee the payment record could not hold", async () => {
    h.fee = 100_001;
    await expect(start()).rejects.toThrow(PAYMENT_TOO_LARGE_MESSAGE);
    expect(h.paypal.created).toBe(0);
  });

  it("starts the checkout when every rule allows it", async () => {
    h.orders.clear();
    await expect(start()).resolves.toEqual({ orderId: "ORDER-1" });
    expect(h.paypal.created).toBe(1);
    expect(order().status).toBe("created");
  });
});

describe("the check right before the capture", () => {
  it("refuses before the money moves: no capture, no record, the order left as it was", async () => {
    h.precondition = { data: "GAME_FULL", error: null };
    await expect(capture()).rejects.toThrow(PAYMENT_PRECONDITION_MESSAGES.GAME_FULL);
    expect(h.paypal.captured).toBe(0);
    expect(h.submissions).toEqual([]);
    expect(order().status).toBe("created");
  });

  it("is asked as the player, about the order's own game", async () => {
    await capture();
    expect(h.playerRpcs).toEqual([
      { name: "paypal_payment_precondition", args: { _game_id: "g-order" } },
    ]);
  });

  it("fails closed when the check itself fails", async () => {
    h.precondition = { data: null, error: { message: "timeout" } };
    await expect(capture()).rejects.toThrow(PAYMENT_CHECK_FAILED_MESSAGE);
    expect(h.paypal.captured).toBe(0);
    expect(h.submissions).toEqual([]);
  });

  it("captures, records once and places the player when every rule allows it", async () => {
    await expect(capture()).resolves.toMatchObject({ ok: true, already: false });
    expect(h.paypal.captured).toBe(1);
    expect(order()).toMatchObject({ status: "captured", capture_id: "CAPTURE-1" });
    expect(h.submissions).toHaveLength(1);
    expect(h.submissions[0]).toMatchObject({
      status: "verified",
      transaction_reference: "CAPTURE-1",
      paid_amount: 10,
    });
    expect(h.rostered).toEqual([PLAYER]);
    expect(h.notifications).toBe(1);
  });
});

describe("which orders can be captured", () => {
  it.each([
    ["failed", ORDER_NOT_CAPTURABLE_MESSAGE],
    ["cancelled", ORDER_NOT_CAPTURABLE_MESSAGE],
    ["capturing", CAPTURE_IN_PROGRESS_MESSAGE],
    ["refunded_unrecorded", PAYMENT_REFUNDED_MESSAGE],
    ["captured_unrecorded", PAYMENT_UNRECORDED_MESSAGE],
  ])("an order that is %s is not captured", async (status, message) => {
    seedOrder({ status });
    await expect(capture()).rejects.toThrow(message);
    expect(h.paypal.looked).toBe(0);
    expect(h.paypal.captured).toBe(0);
    expect(order().status).toBe(status);
    expect(h.submissions).toEqual([]);
  });

  it("an order whose PayPal side no longer matches is marked failed, before any capture", async () => {
    h.getOrder = async () => ({ ...details("APPROVED"), amountValue: "1.00" });
    await expect(capture()).rejects.toThrow(PAYPAL_MISMATCH_MESSAGE);
    expect(h.paypal.captured).toBe(0);
    expect(order().status).toBe("failed");
  });
});

describe("two captures of one order", () => {
  it("a late second request never turns the captured order into a failed one", async () => {
    // B reads the order while it is still 'created', then waits; A captures it; then PayPal tells B it is COMPLETED.
    let releaseB!: () => void;
    const gateB = new Promise<void>((r) => (releaseB = r));
    let bAsked!: () => void;
    const bReached = new Promise<void>((r) => (bAsked = r));
    h.getOrder = async (n) => {
      if (n === 1) {
        bAsked();
        await gateB;
        return details("COMPLETED", "CAPTURE-1");
      }
      return details("APPROVED");
    };
    const b = capture();
    await bReached;
    await expect(capture()).resolves.toMatchObject({ ok: true, already: false });
    releaseB();
    await expect(b).rejects.toThrow(PAYPAL_MISMATCH_MESSAGE);
    expect(order().status).toBe("captured");
    expect(h.paypal.captured).toBe(1);
    expect(h.submissions).toHaveLength(1);
  });

  it("two requests at once: one captures, the other is told it is under way", async () => {
    // Both have read the order as 'created' and checked it with PayPal before either goes on.
    let both!: () => void;
    const together = new Promise<void>((r) => (both = r));
    let firstAsked!: () => void;
    const firstReached = new Promise<void>((r) => (firstAsked = r));
    h.getOrder = async (n) => {
      if (n === 1) firstAsked();
      if (n === 2) both();
      await together;
      return details("APPROVED");
    };
    // The second starts once the first is parked at PayPal: vitest can hand the real module, not the fake, to two
    // dynamic imports of it in flight at once.
    const first = capture();
    await firstReached;
    const results = await Promise.allSettled([first, capture()]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason.message).toBe(CAPTURE_IN_PROGRESS_MESSAGE);
    expect(h.paypal.captured).toBe(1);
    expect(h.submissions).toHaveLength(1);
    expect(order().status).toBe("captured");
  });
});

describe("a captured payment that cannot be recorded", () => {
  it("is refunded, the order says so, it is reported, and the player is told plainly", async () => {
    h.insertError.payment_submissions = { message: "Host approval required" };
    await expect(capture()).rejects.toThrow(PAYMENT_REFUNDED_MESSAGE);
    expect(h.paypal.refunded).toEqual(["CAPTURE-1"]);
    expect(order()).toMatchObject({ status: "refunded_unrecorded", capture_id: "CAPTURE-1" });
    expect(h.reports.some((m) => /PAYPAL_CAPTURED_UNRECORDED_INSERT_FAILED/.test(m))).toBe(true);
    expect(h.rostered).toEqual([]);
    expect(h.notifications).toBe(0);
  });

  it("when the refund fails too, the order is kept as captured_unrecorded and the player is not told it worked", async () => {
    h.insertError.payment_submissions = { message: "boom" };
    h.refund = async () => {
      throw new Error("PayPal refund failed (500).");
    };
    const outcome = capture();
    await expect(outcome).rejects.toThrow(PAYMENT_UNRECORDED_MESSAGE);
    expect(order()).toMatchObject({ status: "captured_unrecorded", capture_id: "CAPTURE-1" });
    expect(h.reports.some((m) => /PAYPAL_REFUND_FAILED/.test(m))).toBe(true);
    expect(h.rostered).toEqual([]);
    // A later attempt does not capture again and does not claim success.
    await expect(capture()).rejects.toThrow(PAYMENT_UNRECORDED_MESSAGE);
    expect(h.paypal.captured).toBe(1);
  });

  it("a capture that does not match what was checked is refunded, not recorded", async () => {
    h.captureOrder = async () => ({ ...details("COMPLETED", "CAPTURE-1"), amountValue: "99.00" });
    await expect(capture()).rejects.toThrow(PAYMENT_REFUNDED_MESSAGE);
    expect(h.paypal.refunded).toEqual(["CAPTURE-1"]);
    expect(h.submissions).toEqual([]);
    expect(order().status).toBe("refunded_unrecorded");
  });

  it("a recorded payment whose order cannot be marked is still a success, and is reported", async () => {
    // Every order update fails from the claim's next step on: the claim itself is made first.
    h.getOrder = async () => details("APPROVED");
    h.captureOrder = async () => {
      h.updateError = { message: "db down" };
      return details("COMPLETED", "CAPTURE-1");
    };
    await expect(capture()).resolves.toMatchObject({ ok: true, already: false });
    expect(h.submissions).toHaveLength(1);
    expect(h.paypal.refunded).toEqual([]);
    expect(h.reports.some((m) => /RECORDED_ORDER_NOT_MARKED/.test(m))).toBe(true);
  });
});

describe("when the capture call itself fails", () => {
  it("and PayPal says the order is still uncaptured: the claim is released, nothing was charged", async () => {
    h.captureOrder = async () => {
      throw new Error("INSTRUMENT_DECLINED");
    };
    h.getOrder = async (n) => details(n === 1 ? "APPROVED" : "APPROVED");
    await expect(capture()).rejects.toThrow(CAPTURE_DECLINED_MESSAGE);
    expect(order().status).toBe("created");
    expect(h.submissions).toEqual([]);
  });

  it("and PayPal says it was captured after all: the payment is recorded", async () => {
    h.captureOrder = async () => {
      throw new Error("socket hang up");
    };
    h.getOrder = async (n) =>
      n === 1 ? details("APPROVED") : details("COMPLETED", "CAPTURE-LATE");
    await expect(capture()).resolves.toMatchObject({ ok: true, already: false });
    expect(h.submissions).toHaveLength(1);
    expect(order()).toMatchObject({ status: "captured", capture_id: "CAPTURE-LATE" });
  });

  it("and PayPal cannot be asked: the order stays held for support and the player is not told it worked", async () => {
    h.captureOrder = async () => {
      throw new Error("socket hang up");
    };
    h.getOrder = async (n) => {
      if (n === 1) return details("APPROVED");
      throw new Error("PayPal order lookup failed (503).");
    };
    await expect(capture()).rejects.toThrow(CAPTURE_UNCONFIRMED_MESSAGE);
    expect(order().status).toBe("capturing");
    expect(h.reports.some((m) => /PAYPAL_CAPTURE_UNCONFIRMED/.test(m))).toBe(true);
    await expect(capture()).rejects.toThrow(CAPTURE_IN_PROGRESS_MESSAGE);
    expect(h.paypal.captured).toBe(1);
  });
});

describe("an order already captured", () => {
  it("with its payment recorded: says so, captures nothing and records nothing", async () => {
    seedOrder({ status: "captured", capture_id: "CAPTURE-1" });
    h.submissions.push({
      game_id: "g-order",
      player_id: PLAYER,
      transaction_reference: "CAPTURE-1",
    });
    h.precondition = { data: "ALREADY_PAID", error: null };
    await expect(capture()).resolves.toEqual({ ok: true, already: true, rostered: null });
    expect(h.paypal.captured).toBe(0);
    expect(h.submissions).toHaveLength(1);
    expect(h.playerRpcs).toEqual([]);
  });

  it("without a payment record: records it again rather than report success with no record", async () => {
    seedOrder({ status: "captured", capture_id: "CAPTURE-1" });
    await expect(capture()).resolves.toEqual({ ok: true, already: true, rostered: true });
    expect(h.paypal.captured).toBe(0);
    expect(h.submissions).toHaveLength(1);
    expect(h.submissions[0]).toMatchObject({
      transaction_reference: "CAPTURE-1",
      status: "verified",
    });
    expect(order().status).toBe("captured");
    expect(h.rostered).toEqual([PLAYER]);
  });

  it("without a record that cannot be written: refunds it", async () => {
    seedOrder({ status: "captured", capture_id: "CAPTURE-1" });
    h.insertError.payment_submissions = { message: "boom" };
    await expect(capture()).rejects.toThrow(PAYMENT_REFUNDED_MESSAGE);
    expect(h.paypal.refunded).toEqual(["CAPTURE-1"]);
    expect(order().status).toBe("refunded_unrecorded");
  });
});

/**
 * What paypal_payment_precondition says about money this player already has moving for the order's game (762 checks
 * the SQL): a verified payment is ALREADY_PAID; an order whose money moved and is not recorded is PAYMENT_IN_PROGRESS.
 */
function preconditionLikeTheDatabase() {
  const mine = (r: Row) => r.player_id === PLAYER && r.game_id === "g-order";
  if (h.submissions.some((s) => mine(s) && s.status === "verified"))
    return { data: "ALREADY_PAID", error: null };
  const recorded = (o: Row) =>
    h.submissions.some((s) => mine(s) && s.transaction_reference === (o.capture_id ?? o.order_id));
  const unsettled = [...h.orders.values()].some(
    (o) =>
      mine(o) &&
      (o.status === "captured_unrecorded" ||
        (o.status === "capturing" && o.capture_id) ||
        (o.status === "captured" && !recorded(o))),
  );
  return { data: unsettled ? "PAYMENT_IN_PROGRESS" : null, error: null };
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const gate = () => {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
};
const verified = () => h.submissions.filter((s) => s.status === "verified");

describe("two PayPal orders for one game (review: charged twice)", () => {
  beforeEach(() => {
    seedOrder({}, "ORDER-2");
    h.preconditionFn = async () => preconditionLikeTheDatabase();
  });

  it("while one order is being captured, a second order for the same game is not captured", async () => {
    const atPayPal = gate();
    const release = gate();
    let n = 0;
    h.captureOrder = async () => {
      n += 1;
      if (n === 1) atPayPal.open();
      await release.p;
      return details("COMPLETED", `CAPTURE-${n}`);
    };
    const first = capture("ORDER-1");
    await atPayPal.p;
    const second = capture("ORDER-2");
    second.catch(() => {}); // settled below; refused before the release
    await settle();
    release.open();
    const [a, b] = await Promise.allSettled([first, second]);
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("rejected");
    expect((b as PromiseRejectedResult).reason.message).toBe(CAPTURE_IN_PROGRESS_MESSAGE);
    expect(h.paypal.captured).toBe(1);
    expect(verified()).toHaveLength(1);
    expect(h.orders.get("ORDER-2")!.status).toBe("created");
  });

  it("an order left mid-capture (PayPal could not be asked) stops a second order being captured", async () => {
    let calls = 0;
    h.captureOrder = async () => {
      calls += 1;
      if (calls === 1) throw new Error("timeout");
      return details("COMPLETED", "CAPTURE-2");
    };
    h.getOrder = async (k) => {
      if (k === 2) throw new Error("PayPal down");
      return details("APPROVED");
    };
    await expect(capture("ORDER-1")).rejects.toThrow(CAPTURE_UNCONFIRMED_MESSAGE);
    expect(h.orders.get("ORDER-1")!.status).toBe("capturing");
    await expect(capture("ORDER-2")).rejects.toThrow(CAPTURE_IN_PROGRESS_MESSAGE);
    expect(h.paypal.captured).toBe(1);
    expect(h.orders.get("ORDER-2")!.status).toBe("created");
  });

  it("the rules are asked after the order is held, so an answer given before another order paid cannot let a second capture through", async () => {
    // B's answer is worked out first and reaches B only after A has captured and recorded its payment.
    const bAsked = gate();
    const late = gate();
    h.preconditionFn = async (k) => {
      const answer = preconditionLikeTheDatabase();
      if (k === 1) {
        bAsked.open();
        await late.p;
      }
      return answer;
    };
    const second = capture("ORDER-2");
    await bAsked.p;
    await capture("ORDER-1").catch(() => null);
    late.open();
    await second.catch(() => null);
    expect(h.paypal.captured).toBe(1);
    expect(verified()).toHaveLength(1);
  });
});

describe("two repairs of one captured order (review: recorded twice)", () => {
  it("the record is looked for again once the order is held, so it is written once", async () => {
    seedOrder({ status: "captured", capture_id: "CAPTURE-1" });
    const aLooked = gate();
    const bLooked = gate();
    const aDone = gate();
    // A and B both find no record; B's answer arrives only after A has written the record and released the order.
    h.lookupHook = async (n) => {
      if (n === 1) {
        aLooked.open();
        await bLooked.p;
      }
      if (n === 2) {
        bLooked.open();
        await aDone.p;
      }
    };
    const a = capture();
    await aLooked.p;
    const b = capture();
    await expect(a).resolves.toMatchObject({ ok: true, already: true });
    aDone.open();
    await expect(b).resolves.toMatchObject({ ok: true, already: true });
    expect(h.submissions).toHaveLength(1);
    expect(h.paypal.refunded).toEqual([]);
    expect(order().status).toBe("captured");
  });
});

describe("what PayPal answers to the capture (review)", () => {
  it("a capture answer with no readable result is checked with PayPal, not taken as a decline", async () => {
    h.captureOrder = async () => ({
      status: "",
      captureId: null,
      captureStatus: null,
      amountValue: null,
      currency: null,
      payeeMerchantId: null,
    });
    h.getOrder = async (n) => (n === 1 ? details("APPROVED") : details("COMPLETED", "CAPTURE-1"));
    await expect(capture()).resolves.toMatchObject({ ok: true, already: false });
    expect(h.paypal.looked).toBe(2);
    expect(order()).toMatchObject({ status: "captured", capture_id: "CAPTURE-1" });
    expect(h.submissions).toHaveLength(1);
  });

  it("and when PayPal then says nothing was captured, the order is failed and nothing recorded", async () => {
    h.captureOrder = async () => ({ ...details("APPROVED"), status: "" });
    await expect(capture()).rejects.toThrow(CAPTURE_DECLINED_MESSAGE);
    expect(h.paypal.looked).toBe(2);
    expect(order().status).toBe("failed");
    expect(h.submissions).toEqual([]);
  });

  it("a capture PayPal still holds as PENDING is not recorded as paid: the order is held for support", async () => {
    h.captureOrder = async () => ({
      ...details("COMPLETED", "CAPTURE-1"),
      captureStatus: "PENDING",
    });
    await expect(capture()).rejects.toThrow(CAPTURE_PENDING_MESSAGE);
    expect(h.submissions).toEqual([]);
    expect(h.rostered).toEqual([]);
    expect(h.paypal.refunded).toEqual([]);
    expect(order()).toMatchObject({ status: "capturing", capture_id: "CAPTURE-1" });
    expect(h.reports.some((m) => /PAYPAL_CAPTURE_PENDING/.test(m))).toBe(true);
  });

  it("a capture answer without the payee is checked against the payee PayPal confirmed before the capture", async () => {
    h.captureOrder = async () => ({ ...details("COMPLETED", "CAPTURE-1"), payeeMerchantId: null });
    await expect(capture()).resolves.toMatchObject({ ok: true, already: false });
    expect(h.paypal.refunded).toEqual([]);
    expect(h.submissions).toHaveLength(1);
  });

  it("a capture answer naming a different payee is still refunded", async () => {
    h.captureOrder = async () => ({
      ...details("COMPLETED", "CAPTURE-1"),
      payeeMerchantId: "SOMEONEELSE",
    });
    await expect(capture()).rejects.toThrow(PAYMENT_REFUNDED_MESSAGE);
    expect(h.paypal.refunded).toEqual(["CAPTURE-1"]);
    expect(h.submissions).toEqual([]);
  });
});

describe("PayPal's own error text stays on the server (review)", () => {
  it("starting a checkout when PayPal refuses the order", async () => {
    h.orders.clear();
    h.createOrder = async () => {
      throw new Error("PAYEE_ACCOUNT_RESTRICTED: the payee account is restricted");
    };
    const error = await start().catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/PAYEE_ACCOUNT_RESTRICTED/);
    expect((error as Error).message).toBe(PAYPAL_UNAVAILABLE_MESSAGE);
    expect(paymentPolicyMessageOf(error)).toBe(PAYPAL_UNAVAILABLE_MESSAGE);
    expect(h.orders.size).toBe(0);
  });

  it("capturing when PayPal's order lookup fails before the capture", async () => {
    h.getOrder = async () => {
      throw new Error("PAYEE_ACCOUNT_RESTRICTED: the payee account is restricted");
    };
    const error = await capture().catch((e: Error) => e);
    expect((error as Error).message).toBe(PAYMENT_CHECK_FAILED_MESSAGE);
    expect(h.paypal.captured).toBe(0);
    expect(order().status).toBe("created");
  });
});

describe("the messages", () => {
  it("every one the server raises can be shown to the player as it is", () => {
    for (const m of [
      ...Object.values(PAYMENT_PRECONDITION_MESSAGES),
      PAYMENT_CHECK_FAILED_MESSAGE,
      PAYMENT_REFUSED_MESSAGE,
      PAYMENT_TOO_LARGE_MESSAGE,
      PAYPAL_UNAVAILABLE_MESSAGE,
      ORDER_NOT_CAPTURABLE_MESSAGE,
      PAYPAL_MISMATCH_MESSAGE,
      CAPTURE_DECLINED_MESSAGE,
      CAPTURE_IN_PROGRESS_MESSAGE,
      CAPTURE_UNCONFIRMED_MESSAGE,
      CAPTURE_PENDING_MESSAGE,
      PAYMENT_REFUNDED_MESSAGE,
      PAYMENT_UNRECORDED_MESSAGE,
    ]) {
      expect(PAYMENT_POLICY_MESSAGES).toContain(m);
      expect(paymentPolicyMessageOf(new Error(m))).toBe(m);
    }
  });

  it("a refusal before any money moved says so", () => {
    for (const m of [
      ...Object.values(PAYMENT_PRECONDITION_MESSAGES),
      PAYMENT_CHECK_FAILED_MESSAGE,
      PAYMENT_REFUSED_MESSAGE,
      PAYMENT_TOO_LARGE_MESSAGE,
      PAYPAL_UNAVAILABLE_MESSAGE,
      ORDER_NOT_CAPTURABLE_MESSAGE,
      PAYPAL_MISMATCH_MESSAGE,
      CAPTURE_DECLINED_MESSAGE,
    ]) {
      expect(m.endsWith("You weren't charged.")).toBe(true);
    }
  });

  it("a message after money moved never says nothing was charged", () => {
    for (const m of [
      CAPTURE_UNCONFIRMED_MESSAGE,
      CAPTURE_PENDING_MESSAGE,
      PAYMENT_REFUNDED_MESSAGE,
      PAYMENT_UNRECORDED_MESSAGE,
      CAPTURE_IN_PROGRESS_MESSAGE,
    ]) {
      expect(m).not.toMatch(/weren't charged/);
    }
  });

  it("PayPal's own error text is never passed on", () => {
    expect(paymentPolicyMessageOf(new Error("PayPal capture failed (422)."))).toBeNull();
  });
});

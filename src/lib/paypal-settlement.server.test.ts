/* eslint-disable @typescript-eslint/no-explicit-any -- hand-rolled Supabase stub */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCaptureResponse } from "./paypal.server";
import { CAPTURING_GRACE_MS, settlePendingPayPalOrder } from "./paypal-settlement.server";

const state = {
  order: null as any,
  claimRows: [{ order_id: "ORDER-1" }] as unknown[],
  /** rows returned by successive conditional writes; when empty, claimRows */
  writeRows: [] as unknown[][],
  updates: [] as any[],
  inserts: [] as any[],
  insertError: null as any,
};

const admin: any = {
  from(table: string) {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: table === "paypal_orders" ? state.order : null }),
      update: (patch: any) => {
        const entry = { table, patch, filters: [] as any[] };
        state.updates.push(entry);
        const u: any = {
          eq: (col: string, val: unknown) => (entry.filters.push(["eq", col, val]), u),
          in: (col: string, val: unknown) => (entry.filters.push(["in", col, val]), u),
          is: (col: string, val: unknown) => (entry.filters.push(["is", col, val]), u),
          select: async () => ({
            data: state.writeRows.length ? state.writeRows.shift() : state.claimRows,
          }),
          then: (resolve: (v: unknown) => void) => resolve({ error: null }),
        };
        return u;
      },
      insert: async (row: any) => {
        state.inserts.push({ table, row });
        return { error: state.insertError };
      },
    };
    return chain;
  },
};

const NOW = Date.parse("2026-11-05T12:00:00Z");
const order = (status: string, ageMs = 60 * 60 * 1000) => ({
  order_id: "ORDER-1",
  game_id: "g1",
  player_id: "p1",
  host_id: "h1",
  amount_cents: 1000,
  currency: "USD",
  status,
  created_at: new Date(NOW - ageMs).toISOString(),
  capture_claim: null as string | null,
  capture_claimed_at: null as string | null,
});
const capture = (status: string) =>
  parseCaptureResponse({
    status: "COMPLETED",
    purchase_units: [
      {
        payee: { merchant_id: "MERCH" },
        payments: {
          captures: [{ id: "CAP-1", status, amount: { value: "10.00", currency_code: "USD" } }],
        },
      },
    ],
  });

const deps = (status: string) => ({
  admin,
  getOrderCapture: vi.fn(async () => capture(status)),
  refundCapture: vi.fn(async () => ({})),
  merchantIdFor: async () => "MERCH",
  now: () => NOW,
});

beforeEach(() => {
  state.order = null;
  state.claimRows = [{ order_id: "ORDER-1" }];
  state.writeRows = [];
  state.updates = [];
  state.inserts = [];
  state.insertError = null;
});

describe("settlePendingPayPalOrder (F04 later settlement)", () => {
  it("a pending capture that PayPal now reports COMPLETED becomes one verified payment", async () => {
    state.order = order("capture_pending");
    const d = deps("COMPLETED");
    await expect(settlePendingPayPalOrder("ORDER-1", d)).resolves.toEqual({ kind: "verified" });
    const payments = state.inserts.filter((i) => i.table === "payment_submissions");
    expect(payments).toHaveLength(1);
    expect(payments[0].row).toMatchObject({
      status: "verified",
      transaction_reference: "CAP-1",
      paypal_order_id: "ORDER-1",
    });
  });

  it("a capture that is still PENDING stays pending and grants nothing", async () => {
    state.order = order("capture_pending");
    await expect(settlePendingPayPalOrder("ORDER-1", deps("PENDING"))).resolves.toEqual({
      kind: "pending",
    });
    expect(state.inserts).toHaveLength(0);
  });

  it("a capture that was DECLINED fails the order", async () => {
    state.order = order("capture_pending");
    await expect(settlePendingPayPalOrder("ORDER-1", deps("DECLINED"))).resolves.toMatchObject({
      kind: "failed",
    });
    expect(state.inserts).toHaveLength(0);
  });

  it("an order still being captured (within the grace period) is left alone", async () => {
    state.order = order("capturing", CAPTURING_GRACE_MS / 2);
    const d = deps("COMPLETED");
    await expect(settlePendingPayPalOrder("ORDER-1", d)).resolves.toEqual({ kind: "in_flight" });
    expect(d.getOrderCapture).not.toHaveBeenCalled();
  });

  it("a settlement that loses the claim to another call does nothing", async () => {
    state.order = order("capture_pending");
    state.claimRows = [];
    const d = deps("COMPLETED");
    await expect(settlePendingPayPalOrder("ORDER-1", d)).resolves.toEqual({ kind: "in_flight" });
    expect(d.getOrderCapture).not.toHaveBeenCalled();
  });

  it("a captured, failed or unknown order is not settleable", async () => {
    for (const s of ["captured", "failed", "created"]) {
      state.order = order(s);
      await expect(settlePendingPayPalOrder("ORDER-1", deps("COMPLETED"))).resolves.toEqual({
        kind: "not_settleable",
      });
    }
    state.order = null;
    await expect(settlePendingPayPalOrder("ORDER-1", deps("COMPLETED"))).resolves.toEqual({
      kind: "not_settleable",
    });
    expect(state.inserts).toHaveLength(0);
  });

  it("a duplicate settlement of an already recorded capture is not counted twice or refunded", async () => {
    state.order = order("capture_pending");
    state.insertError = { message: "duplicate key", code: "23505" };
    const d = deps("COMPLETED");
    await expect(settlePendingPayPalOrder("ORDER-1", d)).resolves.toEqual({
      kind: "already_recorded",
    });
    expect(d.refundCapture).not.toHaveBeenCalled();
  });

  // Independent review of d604958c: two settlements could both claim a stale 'capturing' order, and a delayed
  // PENDING then overwrote the completed one.
  it("the claim writes a fresh token, compare-and-set on the token it read", async () => {
    state.order = { ...order("capturing"), capture_claim: "STALE-TOKEN" };
    await settlePendingPayPalOrder("ORDER-1", deps("COMPLETED"));
    const claim = state.updates.find((u) => u.table === "paypal_orders" && u.patch.capture_claim);
    expect(claim.patch.capture_claim).toMatch(/^[0-9a-f-]{36}$/);
    expect(claim.patch.capture_claim).not.toBe("STALE-TOKEN");
    expect(claim.filters).toContainEqual(["eq", "capture_claim", "STALE-TOKEN"]);
    expect(claim.filters).toContainEqual(["eq", "status", "capturing"]);
    // every later write requires the new token and status 'capturing'
    const later = state.updates.filter((u) => u !== claim && u.table === "paypal_orders");
    expect(later.length).toBeGreaterThan(0);
    for (const u of later) {
      expect(u.filters).toContainEqual(["eq", "capture_claim", claim.patch.capture_claim]);
      expect(u.filters).toContainEqual(["eq", "status", "capturing"]);
    }
  });

  it("a delayed PENDING from a superseded settlement writes nothing and grants nothing", async () => {
    state.order = order("capturing");
    state.writeRows = [[{ order_id: "ORDER-1" }], []]; // the claim succeeds; by the time PayPal answers it is gone
    const d = deps("PENDING");
    await expect(settlePendingPayPalOrder("ORDER-1", d)).resolves.toEqual({ kind: "superseded" });
    expect(state.inserts).toHaveLength(0);
    expect(d.refundCapture).not.toHaveBeenCalled();
  });

  it("a superseded settlement of a COMPLETED capture records no second payment", async () => {
    state.order = order("capturing");
    state.writeRows = [[{ order_id: "ORDER-1" }], []];
    const d = deps("COMPLETED");
    await expect(settlePendingPayPalOrder("ORDER-1", d)).resolves.toEqual({ kind: "superseded" });
    expect(state.inserts).toHaveLength(0);
  });

  it("the grace period counts from the latest claim, not from the order's creation", async () => {
    state.order = {
      ...order("capturing"),
      capture_claim: "T",
      capture_claimed_at: new Date(NOW - CAPTURING_GRACE_MS / 2).toISOString(),
    };
    const d = deps("COMPLETED");
    await expect(settlePendingPayPalOrder("ORDER-1", d)).resolves.toEqual({ kind: "in_flight" });
    expect(d.getOrderCapture).not.toHaveBeenCalled();
  });
});

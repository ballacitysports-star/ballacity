/* eslint-disable @typescript-eslint/no-explicit-any -- hand-rolled Supabase stub */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCaptureResponse } from "./paypal.server";
import { CAPTURING_GRACE_MS, settlePendingPayPalOrder } from "./paypal-settlement.server";

const state = {
  order: null as any,
  claimRows: [{ order_id: "ORDER-1" }] as unknown[],
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
        state.updates.push({ table, patch });
        const u: any = {
          eq: () => u,
          in: () => u,
          select: async () => ({ data: state.claimRows }),
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
});

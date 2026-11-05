/**
 * Settling a PayPal capture later (audit F04). Service-only and NOT wired to any route, webhook or schedule: payments
 * are disabled. When payments are enabled, an operator job (or a verified PayPal webhook handler) calls
 * settlePendingPayPalOrder(orderId) for orders in `capture_pending`, and for orders left in `capturing` by a
 * capture call whose outcome was unknown. It re-reads the capture from PayPal and records it exactly as the
 * checkout does (recordCaptureOutcome): COMPLETED and matching becomes a verified payment once; PENDING stays
 * pending; anything else fails or, if money moved, is refunded.
 */
import { recordCaptureOutcome, type CaptureOutcome } from "./paypal-capture.server";
import type { CaptureResult } from "./paypal.server";

type AdminClient = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/** A `capturing` order younger than this may still have its capture call in flight; leave it alone. */
export const CAPTURING_GRACE_MS = 15 * 60 * 1000;

export type SettlementDeps = {
  admin: AdminClient;
  getOrderCapture: (orderId: string) => Promise<CaptureResult>;
  refundCapture: (captureId: string) => Promise<unknown>;
  merchantIdFor: (gameId: string) => Promise<string | null>;
  now?: () => number;
};

export type SettlementResult = CaptureOutcome | { kind: "not_settleable" } | { kind: "in_flight" };

export async function settlePendingPayPalOrder(
  orderId: string,
  deps: SettlementDeps,
): Promise<SettlementResult> {
  const now = deps.now ?? Date.now;
  const { data: order } = await deps.admin
    .from("paypal_orders")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  const row = order as unknown as {
    order_id: string;
    game_id: string;
    player_id: string;
    host_id: string;
    amount_cents: number;
    currency: string;
    status: string;
    created_at: string;
  } | null;
  if (!row || (row.status !== "capture_pending" && row.status !== "capturing")) {
    return { kind: "not_settleable" };
  }
  if (
    row.status === "capturing" &&
    now() - new Date(row.created_at).getTime() < CAPTURING_GRACE_MS
  ) {
    return { kind: "in_flight" };
  }

  // Claim it, so a settlement and a checkout retry never record the same capture twice.
  const { data: claimed } = await deps.admin
    .from("paypal_orders")
    .update({ status: "capturing" } as never)
    .eq("order_id", orderId)
    .eq("status", row.status)
    .select("order_id");
  if (!claimed || (claimed as unknown[]).length === 0) return { kind: "in_flight" };

  const result = await deps.getOrderCapture(orderId);
  const expected = {
    amountCents: row.amount_cents,
    currency: row.currency,
    merchantId: await deps.merchantIdFor(row.game_id),
  };
  return recordCaptureOutcome(deps.admin, row, result, expected, deps.refundCapture);
}

/**
 * Settling a PayPal capture later (audit F04). Service-only and NOT wired to any route, webhook or schedule: payments
 * are disabled. When payments are enabled, an operator job (or a verified PayPal webhook handler) calls
 * settlePendingPayPalOrder(orderId) for orders in `capture_pending`, and for orders left in `capturing` by a
 * capture call whose outcome was unknown. It re-reads the capture from PayPal and records it exactly as the
 * checkout does (recordCaptureOutcome): COMPLETED and matching becomes a verified payment once; PENDING stays
 * pending; anything else fails or, if money moved, is refunded.
 */
import {
  newCaptureClaim,
  recordCaptureOutcome,
  type CaptureOutcome,
} from "./paypal-capture.server";
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
    capture_claim: string | null;
    capture_claimed_at: string | null;
  } | null;
  if (!row || (row.status !== "capture_pending" && row.status !== "capturing")) {
    return { kind: "not_settleable" };
  }
  // A claim younger than this may still have its capture call in flight (counted from the latest claim).
  if (
    row.status === "capturing" &&
    now() - new Date(row.capture_claimed_at ?? row.created_at).getTime() < CAPTURING_GRACE_MS
  ) {
    return { kind: "in_flight" };
  }

  // Claim it with a fresh token, compare-and-set on the token read above (independent review of d604958c): of two
  // settlements that read the same row only one wins, and the call it supersedes can no longer write the order.
  const claim = newCaptureClaim();
  let claimQuery = deps.admin
    .from("paypal_orders")
    .update({
      status: "capturing",
      capture_claim: claim,
      capture_claimed_at: new Date(now()).toISOString(),
    } as never)
    .eq("order_id", orderId)
    .eq("status", row.status);
  claimQuery =
    row.capture_claim === null || row.capture_claim === undefined
      ? claimQuery.is("capture_claim" as never, null)
      : claimQuery.eq("capture_claim" as never, row.capture_claim as never);
  const { data: claimed } = await claimQuery.select("order_id");
  if (!claimed || (claimed as unknown[]).length === 0) return { kind: "in_flight" };

  const result = await deps.getOrderCapture(orderId);
  const expected = {
    amountCents: row.amount_cents,
    currency: row.currency,
    merchantId: await deps.merchantIdFor(row.game_id),
  };
  return recordCaptureOutcome(deps.admin, row, result, expected, deps.refundCapture, claim);
}

/**
 * Recording a PayPal capture (audit F04). Shared by the checkout's capture call and by the settlement of a capture
 * that was still pending, so a payment is verified in exactly one way:
 *
 *   - Only a capture whose OWN status is COMPLETED, paying exactly the quoted amount and currency to the payee,
 *     becomes a verified payment. The order-level status never stands in for it.
 *   - PENDING (with the right amount and payee): the order is parked as `capture_pending`; nothing is granted.
 *     settlePendingPayPalOrder() re-reads it from PayPal later.
 *   - DECLINED, FAILED, a missing or ambiguous capture, or a mismatch: the order fails. A COMPLETED capture that
 *     does not match (money moved to the wrong place or in the wrong amount) is refunded.
 *   - The capture id, status, amount, currency, payee and PayPal order status are stored on the order first. The
 *     database then refuses a verified PayPal payment unless that order records a COMPLETED capture with the same
 *     id for the same player and game, and allows one payment per capture id (migration 20261108170000).
 *   - Only the call holding the order's current claim records anything (independent review of d604958c): each claim
 *     writes a fresh token (capture_claim), and every write here requires that token and status `capturing`. A
 *     delayed call whose claim was superseded (a settlement re-claimed a stale order, or a second settlement raced
 *     the first) writes nothing, so a late PENDING can never overwrite a completed capture. The database also keeps a
 *     captured order captured (only a refund follows).
 */
import type { CaptureResult } from "./paypal.server";

type AdminClient = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

export type PayPalOrderRow = {
  order_id: string;
  game_id: string;
  player_id: string;
  host_id: string;
  amount_cents: number;
  currency: string;
};

export type Expected = {
  amountCents: number;
  currency: string;
  merchantId: string | null | undefined;
};

export type CaptureOutcome =
  | { kind: "verified" }
  | { kind: "already_recorded" }
  | { kind: "pending" }
  | { kind: "refunded"; reason: string }
  | { kind: "unrecorded"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "superseded" };

function cents(v: string | null) {
  return v ? Math.round(Number(v) * 100) : NaN;
}

export function captureMatches(result: CaptureResult, expected: Expected) {
  return (
    cents(result.amountValue) === expected.amountCents &&
    result.currency === expected.currency &&
    !!result.payeeMerchantId &&
    result.payeeMerchantId === expected.merchantId &&
    !!result.captureId
  );
}

function captureFields(result: CaptureResult) {
  return {
    capture_id: result.captureId,
    capture_status: result.status,
    capture_amount_cents: Number.isFinite(cents(result.amountValue))
      ? cents(result.amountValue)
      : null,
    capture_currency: result.currency,
    capture_payee_merchant_id: result.payeeMerchantId,
    paypal_order_status: result.orderStatus || null,
  };
}

/** A fresh claim token: written with the claim, required by every later write of that claimant. */
export function newCaptureClaim() {
  return crypto.randomUUID();
}

/** Writes the order only while `claim` still holds it in `capturing`. Returns whether a row was written. */
async function setOrder(
  admin: AdminClient,
  orderId: string,
  claim: string,
  patch: Record<string, unknown>,
) {
  const { data } = await admin
    .from("paypal_orders")
    .update(patch as never)
    .eq("order_id", orderId)
    .eq("status", "capturing")
    .eq("capture_claim" as never, claim as never)
    .select("order_id");
  return !!data && (data as unknown[]).length > 0;
}

/**
 * Applies a capture result to an order the caller has claimed: status `capturing` with the caller's `claim` token
 * (newCaptureClaim). `refund` is injected so tests (and the settlement job) control the PayPal call.
 */
export async function recordCaptureOutcome(
  admin: AdminClient,
  order: PayPalOrderRow,
  result: CaptureResult,
  expected: Expected,
  refund: (captureId: string) => Promise<unknown>,
  claim: string,
): Promise<CaptureOutcome> {
  const fields = captureFields(result);
  const matches = captureMatches(result, expected);

  if (result.status === "PENDING" && matches) {
    return (await setOrder(admin, order.order_id, claim, { status: "capture_pending", ...fields }))
      ? { kind: "pending" }
      : { kind: "superseded" };
  }

  if (result.status !== "COMPLETED" || !matches) {
    // Money that did move but cannot be verified goes back.
    if (result.status === "COMPLETED" && result.captureId) {
      // Record the capture under this claim first: a superseded call leaves the refund to the claim holder.
      if (!(await setOrder(admin, order.order_id, claim, fields))) return { kind: "superseded" };
      const refunded = await refund(result.captureId)
        .then(() => true)
        .catch((e) => {
          console.error("[paypal] refund of an unverifiable capture failed", e);
          return false;
        });
      await setOrder(admin, order.order_id, claim, {
        status: refunded ? "refunded" : "unrecorded",
        captured_at: new Date().toISOString(),
      });
      return refunded
        ? { kind: "refunded", reason: "mismatch" }
        : { kind: "unrecorded", reason: "mismatch" };
    }
    return (await setOrder(admin, order.order_id, claim, { status: "failed", ...fields }))
      ? { kind: "failed", reason: result.status }
      : { kind: "superseded" };
  }

  // COMPLETED and matching. Store the capture on the order first: the database checks the payment against it.
  if (
    !(await setOrder(admin, order.order_id, claim, {
      ...fields,
      captured_at: new Date().toISOString(),
    }))
  )
    return { kind: "superseded" };
  // paypal_order_id is newer than the generated types (migration 20261108170000).
  const payment = {
    game_id: order.game_id,
    host_id: order.host_id,
    player_id: order.player_id,
    payment_method_id: null,
    payment_type: "paypal",
    paypal_order_id: order.order_id,
    screenshot_path: null,
    transaction_reference: result.captureId,
    paid_amount: order.amount_cents / 100,
    paid_at: new Date().toISOString(),
    notes: "Paid with PayPal checkout",
    status: "verified",
    reviewed_at: new Date().toISOString(),
  };
  const { error: insertError } = await admin.from("payment_submissions").insert(payment as never);
  if (insertError) {
    // A retry or a duplicate callback for a capture that is already recorded: one payment per capture.
    if ((insertError as { code?: string }).code === "23505") {
      await setOrder(admin, order.order_id, claim, { status: "captured" });
      return { kind: "already_recorded" };
    }
    console.error("[paypal] captured payment could not be recorded", insertError.message);
    const refunded = await refund(result.captureId as string)
      .then(() => true)
      .catch((e) => {
        console.error("[paypal] refund after unrecorded capture failed", e);
        return false;
      });
    await setOrder(admin, order.order_id, claim, { status: refunded ? "refunded" : "unrecorded" });
    return refunded
      ? { kind: "refunded", reason: "unrecorded" }
      : { kind: "unrecorded", reason: "unrecorded" };
  }
  await setOrder(admin, order.order_id, claim, { status: "captured" });
  return { kind: "verified" };
}

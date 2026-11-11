import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  CAPTURE_DECLINED_MESSAGE,
  CAPTURE_IN_PROGRESS_MESSAGE,
  CAPTURE_UNCONFIRMED_MESSAGE,
  ORDER_NOT_CAPTURABLE_MESSAGE,
  PAYMENT_CHECK_FAILED_MESSAGE,
  PAYMENT_RECORD_UNCONFIRMED_MESSAGE,
  PAYMENT_REFUNDED_MESSAGE,
  PAYMENT_TOO_LARGE_MESSAGE,
  PAYMENT_UNRECORDED_MESSAGE,
  PAYPAL_MISMATCH_MESSAGE,
  PAYPAL_UNAVAILABLE_MESSAGE,
  CAPTURE_PENDING_MESSAGE,
  paymentPreconditionMessage,
} from "@/lib/payments-policy";

const gameIdSchema = z.object({ gameId: z.string().min(1).max(200) });

type AdminClient = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/**
 * The server's price for a game's PayPal checkout: the host, the fee in cents
 * (latest payment settings, else the game's listed price) and the host's
 * connected merchant id. Null when the game doesn't exist.
 */
async function quoteGamePayPalFee(admin: AdminClient, gameId: string) {
  // Money goes to the game's payee (its host, or a minor host's payment manager), and only the payee's settings count.
  const { data: payeeRaw } = await admin.rpc(
    "game_payee_id" as never,
    { _game_id: gameId } as never,
  );
  const payee = (payeeRaw as unknown as string | null) ?? null;
  const [{ data: game }, { data: settings }] = await Promise.all([
    admin.from("hosted_games").select("title, price, host_id").eq("id", gameId).maybeSingle(),
    admin
      .from("game_payment_settings")
      .select("entry_fee")
      .eq("game_id", gameId)
      .eq("host_id", payee ?? "00000000-0000-0000-0000-000000000000")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!game || !payee) return null;
  const fee = Number(settings?.entry_fee ?? game.price ?? 0);
  const { data: pp } = await admin
    .from("host_paypal_accounts")
    .select("merchant_id")
    .eq("host_id", payee)
    .maybeSingle();
  return {
    hostId: payee,
    title: game.title as string | null,
    amountCents: Number.isFinite(fee) && fee > 0 ? Math.round(fee * 100) : 0,
    merchantId: pp?.merchant_id ?? null,
  };
}

type PlayerClient = Pick<AdminClient, "rpc">;

/**
 * Every rule the database applies to a PayPal payment and to the roster place it buys, asked as the player through
 * public.paypal_payment_precondition (20261111140000). The server records the payment and the place with the service
 * role once PayPal has moved the money, so a rule broken there would take money it then cannot record. This asks
 * first, before an order exists and again right before the capture. Fails closed: an error, or any answer but NULL,
 * refuses with a message the player can read (PAYMENT_POLICY_MESSAGES).
 */
export async function assertPaymentPreconditions(player: PlayerClient, gameId: string) {
  let answer: { data: unknown; error: unknown };
  try {
    answer = await player.rpc(
      "paypal_payment_precondition" as never,
      { _game_id: gameId } as never,
    );
  } catch {
    throw new Error(PAYMENT_CHECK_FAILED_MESSAGE);
  }
  if (answer.error) throw new Error(PAYMENT_CHECK_FAILED_MESSAGE);
  if (answer.data === null) return;
  throw new Error(paymentPreconditionMessage(typeof answer.data === "string" ? answer.data : null));
}

/** payment_submissions.paid_amount accepts at most $100,000 (payment_submissions_paid_amount_check). */
const MAX_AMOUNT_CENTS = 100_000 * 100;

const CAPTURABLE = ["created", "approved"];

/**
 * Moves an order from one status to another only if it is still in the expected one, so two requests for the same
 * order cannot overwrite each other (a second capture never turns a captured order into a failed one). True when
 * exactly this order moved.
 */
async function moveOrder(
  admin: AdminClient,
  orderId: string,
  from: string | string[],
  patch: Record<string, unknown>,
): Promise<boolean> {
  try {
    const base = admin
      .from("paypal_orders")
      .update(patch as never)
      .eq("order_id", orderId);
    const scoped = Array.isArray(from) ? base.in("status", from) : base.eq("status", from);
    const { data, error } = await scoped.select("order_id");
    return !error && Array.isArray(data) && data.length === 1;
  } catch {
    return false;
  }
}

/**
 * A payment problem a superadmin has to see: the server log, with a stable tag, and the app's own error reports
 * (app_error_events, scrubbed of ids). Never throws.
 */
async function reportPaymentProblem(tag: string, orderId: string, cause?: unknown) {
  const detail = cause instanceof Error ? cause.message : cause ? String(cause) : "";
  console.error(`[paypal] ${tag}`, { orderId, detail });
  try {
    const { buildErrorReport } = await import("@/lib/error-report");
    const { saveErrorReport } = await import("@/lib/error-report.server");
    await saveErrorReport(
      buildErrorReport({
        source: "server",
        kind: "server_fn",
        error: new Error(`PAYPAL_${tag.toUpperCase()}${detail ? `: ${detail}` : ""}`),
        route: "/_serverFn/paypal/capture",
        signedIn: true,
      }),
    );
  } catch {
    // reporting never fails the request
  }
}

type PayPalServer = typeof import("@/lib/paypal.server");
type OrderRow = {
  order_id: string;
  game_id: string;
  player_id: string;
  host_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  capture_id: string | null;
};

/**
 * PayPal has the money and it cannot be recorded: give it back. The order ends as refunded_unrecorded, or, when the
 * refund fails too, captured_unrecorded, which a superadmin settles by hand. Always throws, and never tells the
 * player it worked.
 */
async function refundUnrecorded(
  admin: AdminClient,
  paypal: PayPalServer,
  orderId: string,
  captureId: string | null,
  cause: string,
  error?: unknown,
): Promise<never> {
  await reportPaymentProblem(`captured_unrecorded_${cause}`, orderId, error);
  let refunded = false;
  if (captureId) {
    try {
      await paypal.refundCapture(captureId);
      refunded = true;
    } catch (e) {
      await reportPaymentProblem("refund_failed", orderId, e);
    }
  }
  const status = refunded ? "refunded_unrecorded" : "captured_unrecorded";
  const flagged = await moveOrder(admin, orderId, ["capturing", "captured"], {
    status,
    capture_id: captureId,
  });
  if (!flagged) await reportPaymentProblem(`${status}_status_not_saved`, orderId);
  throw new Error(refunded ? PAYMENT_REFUNDED_MESSAGE : PAYMENT_UNRECORDED_MESSAGE);
}

/**
 * Records a captured payment for an order this request holds in 'capturing': the verified payment submission first,
 * then the order as captured, then the roster place and the host's notification. If the submission cannot be written
 * the capture is refunded (refundUnrecorded). Returns whether the player is on the roster.
 */
async function recordCapturedPayment(
  admin: AdminClient,
  paypal: PayPalServer,
  order: OrderRow,
  captureId: string | null,
): Promise<boolean> {
  const now = new Date().toISOString();
  // Verified payment submission: the game page's realtime listener and the roster placement below rely on it.
  let insertError: unknown = null;
  try {
    const { error } = await admin.from("payment_submissions").insert({
      game_id: order.game_id,
      host_id: order.host_id,
      player_id: order.player_id,
      payment_method_id: null,
      payment_type: "paypal",
      screenshot_path: null,
      transaction_reference: captureId ?? order.order_id,
      paid_amount: order.amount_cents / 100,
      paid_at: now,
      notes: "Paid with PayPal checkout",
      status: "verified",
      reviewed_at: now,
    });
    insertError = error;
  } catch (e) {
    insertError = e ?? new Error("insert threw");
  }
  if (insertError) {
    const cause =
      insertError instanceof Error ? insertError : (insertError as { message?: string }).message;
    return refundUnrecorded(admin, paypal, order.order_id, captureId, "insert_failed", cause);
  }

  // The payment is recorded; from here nothing is refunded. A failure is reported for a superadmin to tidy.
  const marked = await moveOrder(admin, order.order_id, "capturing", {
    status: "captured",
    capture_id: captureId,
    captured_at: now,
  });
  if (!marked) await reportPaymentProblem("recorded_order_not_marked", order.order_id);

  let rostered = false;
  try {
    const { addPaidPlayerToRoster } = await import("./roster-on-payment.server");
    rostered = (await addPaidPlayerToRoster(order.game_id, order.player_id)).added;
  } catch (e) {
    console.error("[paypal] roster placement after payment failed", e);
  }

  // Notify the host in-app, non-blocking.
  try {
    const { error } = await admin.from("notifications").insert({
      user_id: order.host_id,
      type: "payment_submitted",
      title: "PayPal payment received",
      body: `A player paid $${(order.amount_cents / 100).toFixed(2)} via PayPal checkout.`,
      link: `/games/${order.game_id}`,
    });
    if (error) console.error("[paypal] host notification failed", error.message);
  } catch (e) {
    console.error("[paypal] host notification failed", e);
  }
  return rostered;
}

/**
 * An order already captured. Normally its payment is recorded and this says so. If the record is missing (an order
 * captured before the record was checked, or one whose record was later removed), it is recorded again, or refunded
 * when that fails. It never reports success without a record.
 */
async function ensureCapturedRecorded(admin: AdminClient, paypal: PayPalServer, order: OrderRow) {
  const reference = order.capture_id ?? order.order_id;
  const isRecorded = async () => {
    try {
      const { data, error } = await admin
        .from("payment_submissions")
        .select("id")
        .eq("game_id", order.game_id)
        .eq("player_id", order.player_id)
        .eq("transaction_reference", reference)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    } catch {
      return null;
    }
  };
  const recorded = await isRecorded();
  if (recorded === null) throw new Error(PAYMENT_RECORD_UNCONFIRMED_MESSAGE);
  // Recorded by the request that captured it, which also placed the player on the roster if it could.
  if (recorded) return { ok: true as const, already: true as const, rostered: null };

  // Hold the order while the record is written, so two repairs cannot record it twice.
  if (!(await moveOrder(admin, order.order_id, "captured", { status: "capturing" }))) {
    throw new Error(CAPTURE_IN_PROGRESS_MESSAGE);
  }
  // Look again now the order is held: a repair that held it before this one may have recorded it since the first look.
  const recordedMeanwhile = await isRecorded();
  if (recordedMeanwhile !== false) {
    if (!(await moveOrder(admin, order.order_id, "capturing", { status: "captured" }))) {
      await reportPaymentProblem("repair_release_not_saved", order.order_id);
    }
    if (recordedMeanwhile === null) throw new Error(PAYMENT_RECORD_UNCONFIRMED_MESSAGE);
    return { ok: true as const, already: true as const, rostered: null };
  }
  await reportPaymentProblem("captured_record_missing_repaired", order.order_id);
  const rostered: boolean | null = await recordCapturedPayment(
    admin,
    paypal,
    order,
    order.capture_id,
  );
  return { ok: true as const, already: true as const, rostered };
}

/**
 * Public config for rendering the PayPal button on a game's pay screen.
 * The client id and merchant id are publishable identifiers, not secrets.
 */
export const getPayPalCheckoutConfig = createServerFn({ method: "GET" })
  .inputValidator((i) => gameIdSchema.parse(i))
  .handler(async ({ data }) => {
    const clientId = process.env.PAYPAL_CLIENT_ID ?? null;
    if (!clientId) return { clientId: null, merchantId: null };
    const { createClient } = await import("@supabase/supabase-js");
    const pub = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const { data: rows } = await pub.rpc("get_game_host_paypal", {
      _game_id: data.gameId,
    });
    const merchantId = (rows as { merchant_id: string }[] | null)?.[0]?.merchant_id ?? null;
    return { clientId, merchantId };
  });

/** Creates a PayPal order for the signed-in player paying a game's host. */
export const createGamePayPalOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => gameIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    // Every payment rule, as the player, before PayPal is asked for anything. Also the visibility check: a game the
    // player cannot see is GAME_NOT_FOUND.
    await assertPaymentPreconditions(context.supabase, data.gameId);

    // Pricing is read with server privileges so it matches what capture recomputes.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const quote = await quoteGamePayPalFee(supabaseAdmin, data.gameId);
    if (!quote) throw new Error("Game not found.");
    if (quote.hostId === context.userId) throw new Error("You host this game.");
    if (quote.amountCents <= 0) throw new Error("This game is free — no payment needed.");
    if (quote.amountCents > MAX_AMOUNT_CENTS) throw new Error(PAYMENT_TOO_LARGE_MESSAGE);
    if (!quote.merchantId) throw new Error("This host hasn't connected PayPal checkout.");

    const { createOrder } = await import("@/lib/paypal.server");
    let orderId: string;
    try {
      ({ orderId } = await createOrder({
        amountCents: quote.amountCents,
        currency: "USD",
        merchantId: quote.merchantId,
        description: `BallaCity: ${quote.title ?? "pickup game"}`,
      }));
    } catch (e) {
      // PayPal's own error (issue codes, auth failures) stays in the server log.
      console.error("[paypal] create order failed", e instanceof Error ? e.message : e);
      throw new Error(PAYPAL_UNAVAILABLE_MESSAGE);
    }

    // Only the server writes orders; players have no insert grant.
    const { error } = await supabaseAdmin.from("paypal_orders").insert({
      order_id: orderId,
      game_id: data.gameId,
      player_id: context.userId,
      host_id: quote.hostId,
      amount_cents: quote.amountCents,
      currency: "USD",
      status: "created",
    });
    if (error) throw new Error("Could not record the order. Please try again.");
    return { orderId };
  });

/**
 * Captures an approved PayPal order, verifies amount + payee server-side, and records a verified payment submission so
 * the roster flow picks it up. The order moves created/approved -> capturing -> captured, each step only from the
 * status it expects. If PayPal takes the money and the payment cannot be recorded, the capture is refunded.
 */
export const captureGamePayPalOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ orderId: z.string().min(3).max(64) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error: readError } = await context.supabase
      .from("paypal_orders")
      .select("*")
      .eq("order_id", data.orderId)
      .maybeSingle();
    if (readError) throw new Error(PAYMENT_CHECK_FAILED_MESSAGE);
    const order = row as OrderRow | null;
    if (!order || order.player_id !== context.userId) throw new Error("Order not found.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const paypal = await import("@/lib/paypal.server");

    if (order.status === "captured") return ensureCapturedRecorded(supabaseAdmin, paypal, order);
    if (order.status === "capturing") throw new Error(CAPTURE_IN_PROGRESS_MESSAGE);
    if (order.status === "refunded_unrecorded") throw new Error(PAYMENT_REFUNDED_MESSAGE);
    if (order.status === "captured_unrecorded") throw new Error(PAYMENT_UNRECORDED_MESSAGE);
    if (!CAPTURABLE.includes(order.status)) throw new Error(ORDER_NOT_CAPTURABLE_MESSAGE);

    // Re-price from the game rather than trusting the stored order row.
    const quote = await quoteGamePayPalFee(supabaseAdmin, order.game_id);
    const expected = {
      amountCents: order.amount_cents,
      currency: "USD",
      merchantId: quote?.merchantId,
    };
    const orderMatchesGame =
      !!quote &&
      quote.hostId === order.host_id &&
      quote.amountCents === order.amount_cents &&
      order.currency === "USD";

    // Check the approved order before capturing: once captured the money has moved, so a payee or amount mismatch
    // must stop it here.
    let pending: Awaited<ReturnType<PayPalServer["getOrder"]>>;
    try {
      pending = await paypal.getOrder(data.orderId);
    } catch (e) {
      console.error(
        "[paypal] order lookup before capture failed",
        e instanceof Error ? e.message : e,
      );
      throw new Error(PAYMENT_CHECK_FAILED_MESSAGE);
    }
    if (
      !orderMatchesGame ||
      !paypal.paypalPaymentMatches(pending, { ...expected, status: "APPROVED" })
    ) {
      await moveOrder(supabaseAdmin, data.orderId, CAPTURABLE, { status: "failed" });
      throw new Error(PAYPAL_MISMATCH_MESSAGE);
    }

    // One capture at a time: whoever moves the order to 'capturing' captures it. A player's other order for the same
    // game cannot be 'capturing' at the same time (paypal_orders_one_capture_per_player_game), so that claim fails too.
    if (!(await moveOrder(supabaseAdmin, data.orderId, CAPTURABLE, { status: "capturing" }))) {
      throw new Error(CAPTURE_IN_PROGRESS_MESSAGE);
    }

    // Every payment rule again, as the player, right before the money moves and after the order is held: an approval
    // may have been withdrawn, the game cancelled or filled, or the player paid by another order or another way since
    // the order was created. Asked after the hold, no other order of theirs for this game can capture in between.
    try {
      await assertPaymentPreconditions(context.supabase, order.game_id);
    } catch (refusal) {
      if (!(await moveOrder(supabaseAdmin, data.orderId, "capturing", { status: order.status }))) {
        await reportPaymentProblem("claim_release_not_saved", data.orderId);
      }
      throw refusal;
    }

    let result: Awaited<ReturnType<PayPalServer["captureOrder"]>> | null = null;
    let captureError: unknown = null;
    try {
      result = await paypal.captureOrder(data.orderId);
    } catch (e) {
      captureError = e;
    }
    if (!result || !result.captureId) {
      // PayPal did not show a capture (an error, a timeout, or an answer without one). Did the money move anyway? Ask
      // PayPal what the order is now rather than guess.
      const after = await paypal.getOrder(data.orderId).catch(() => null);
      if (after && !after.captureId && after.status !== "COMPLETED") {
        // Not captured. After an error the order goes back to how it was so the player can try again.
        await moveOrder(supabaseAdmin, data.orderId, "capturing", {
          status: captureError ? order.status : "failed",
        });
        throw new Error(CAPTURE_DECLINED_MESSAGE);
      }
      if (!after || !after.captureId) {
        // Unknown: the order stays 'capturing' for a superadmin, and the player is not told it worked.
        await reportPaymentProblem("capture_unconfirmed", data.orderId, captureError);
        throw new Error(CAPTURE_UNCONFIRMED_MESSAGE);
      }
      result = after;
    }
    const captureId = result.captureId;

    // The capture's own status says whether the money settled. DECLINED or FAILED: nothing was taken. Anything but
    // COMPLETED (PENDING while PayPal reviews it, or no status): hold the order with its capture id for a superadmin
    // and do not record it as paid.
    if (result.captureStatus === "DECLINED" || result.captureStatus === "FAILED") {
      await moveOrder(supabaseAdmin, data.orderId, "capturing", {
        status: "failed",
        capture_id: captureId,
      });
      throw new Error(CAPTURE_DECLINED_MESSAGE);
    }
    if (result.captureStatus !== "COMPLETED") {
      if (!(await moveOrder(supabaseAdmin, data.orderId, "capturing", { capture_id: captureId }))) {
        await reportPaymentProblem("capture_id_not_saved", data.orderId);
      }
      await reportPaymentProblem(
        "capture_pending",
        data.orderId,
        `capture ${captureId} status ${result.captureStatus ?? "none"}`,
      );
      throw new Error(CAPTURE_PENDING_MESSAGE);
    }

    // The payee: the capture's answer when it names one, else the one PayPal confirmed on this order before the
    // capture (an order's payee does not change once approved).
    const captured = {
      ...result,
      payeeMerchantId: result.payeeMerchantId ?? pending.payeeMerchantId,
    };
    if (!paypal.paypalPaymentMatches(captured, { ...expected, status: "COMPLETED" })) {
      // PayPal took money that does not match what was checked: give it back.
      return refundUnrecorded(supabaseAdmin, paypal, data.orderId, captureId, "capture_mismatch");
    }

    // Keep the capture id on the order before anything else, so a crash from here on leaves it findable.
    if (
      !(await moveOrder(supabaseAdmin, data.orderId, "capturing", {
        capture_id: captureId,
        captured_at: new Date().toISOString(),
      }))
    ) {
      await reportPaymentProblem("capture_id_not_saved", data.orderId);
    }

    const rostered: boolean | null = await recordCapturedPayment(
      supabaseAdmin,
      paypal,
      order,
      captureId,
    );
    return { ok: true as const, already: false as const, rostered };
  });

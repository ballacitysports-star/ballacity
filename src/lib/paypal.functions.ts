import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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

/**
 * Messages for the codes `payment_precondition_error` returns. The same rules
 * as the payment_submissions triggers, checked before any money moves.
 */
const PRECONDITION_MESSAGES: Record<string, string> = {
  GAME_NOT_FOUND: "Game not found.",
  PAYMENTS_NOT_AVAILABLE: "Payment coordination isn't available for this account yet.",
  PAYMENT_DESTINATION_INVALID: "This game can't take payments right now.",
  HOST_APPROVAL_REQUIRED: "The host has to approve your request before you can pay.",
  GUARDIAN_APPROVAL_REQUIRED:
    "A parent or guardian has to approve this game before a payment can be sent.",
};

/**
 * Null when `playerId` may pay for `gameId` now (approved request when one is
 * required, the guardian's approval when the player has a guardian, an adult
 * payee), else the message to show. Fails closed when the check itself fails.
 */
export async function paymentPreconditionError(
  admin: AdminClient,
  gameId: string,
  playerId: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc(
    "payment_precondition_error" as never,
    { _game_id: gameId, _player: playerId } as never,
  );
  if (error) return "Payment checks are unavailable right now. Please try again.";
  const code = (data as unknown as string | null) ?? null;
  if (!code) return null;
  return PRECONDITION_MESSAGES[code] ?? "You can't pay for this game right now.";
}

/**
 * Config for rendering the PayPal button on a game's pay screen. The client id
 * is publishable. The merchant id is the game's payee's, and the database
 * returns it only to a signed-in caller who can see the listing or is involved
 * with the game, and only when the payee is a confirmed adult.
 */
export const getPayPalCheckoutConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => gameIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    const clientId = process.env.PAYPAL_CLIENT_ID ?? null;
    if (!clientId) return { clientId: null, merchantId: null };
    const { data: rows } = await context.supabase.rpc("get_game_host_paypal", {
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
    const { data: allowed } = await (context.supabase.rpc as any)("game_payments_allowed", {
      _user: context.userId,
    });
    if (allowed === false) {
      const { PAYMENTS_BLOCKED_MESSAGE } = await import("@/lib/payments-policy");
      throw new Error(PAYMENTS_BLOCKED_MESSAGE);
    }

    // Visibility check as the player; pricing is read with server privileges
    // so it matches what capture recomputes.
    const { data: visible } = await context.supabase
      .from("hosted_games")
      .select("id")
      .eq("id", data.gameId)
      .maybeSingle();
    if (!visible) throw new Error("Game not found.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const quote = await quoteGamePayPalFee(supabaseAdmin, data.gameId);
    if (!quote) throw new Error("Game not found.");
    if (quote.hostId === context.userId) throw new Error("You host this game.");
    if (quote.amountCents <= 0) throw new Error("This game is free — no payment needed.");
    if (!quote.merchantId) throw new Error("This host hasn't connected PayPal checkout.");
    // The approval and guardian rules the database applies to the payment row, checked before an order exists.
    const blocked = await paymentPreconditionError(supabaseAdmin, data.gameId, context.userId);
    if (blocked) throw new Error(blocked);

    const { createOrder } = await import("@/lib/paypal.server");
    const { orderId } = await createOrder({
      amountCents: quote.amountCents,
      currency: "USD",
      merchantId: quote.merchantId,
      description: `BallaCity: ${quote.title ?? "pickup game"}`,
    });

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
 * Captures an approved PayPal order, verifies amount + payee server-side,
 * and records a verified payment submission so the roster flow picks it up.
 */
export const captureGamePayPalOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ orderId: z.string().min(3).max(64) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: order } = await context.supabase
      .from("paypal_orders")
      .select("*")
      .eq("order_id", data.orderId)
      .maybeSingle();
    if (!order || order.player_id !== context.userId) throw new Error("Order not found.");
    if (order.status === "captured") return { ok: true as const, already: true as const };
    if (order.status !== "created" && order.status !== "approved") {
      throw new Error("This PayPal order can't be completed. Please start again.");
    }

    // Re-price from the game rather than trusting the stored order row.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const quote = await quoteGamePayPalFee(supabaseAdmin, order.game_id);

    const { captureOrder, getOrder, paypalPaymentMatches, refundCapture } =
      await import("@/lib/paypal.server");
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

    // Check the approved order before capturing: once captured the money has
    // moved, so a payee or amount mismatch must stop it here.
    const pending = await getOrder(data.orderId);
    if (!orderMatchesGame || !paypalPaymentMatches(pending, { ...expected, status: "APPROVED" })) {
      await supabaseAdmin
        .from("paypal_orders")
        .update({ status: "failed" })
        .eq("order_id", data.orderId);
      throw new Error(
        "This PayPal payment doesn't match the host's current checkout. You weren't charged — please start again.",
      );
    }

    // Re-check approval and guardian consent for this player now: either may have been withdrawn since the
    // order was created, and once captured the money has moved.
    const blocked = await paymentPreconditionError(supabaseAdmin, order.game_id, order.player_id);
    if (blocked) {
      await supabaseAdmin
        .from("paypal_orders")
        .update({ status: "failed" })
        .eq("order_id", data.orderId);
      throw new Error(`${blocked} You weren't charged.`);
    }

    const result = await captureOrder(data.orderId);

    if (!paypalPaymentMatches(result, { ...expected, status: "COMPLETED" })) {
      await supabaseAdmin
        .from("paypal_orders")
        .update({ status: "failed" })
        .eq("order_id", data.orderId);
      throw new Error("PayPal payment could not be verified. No charge was recorded by us.");
    }

    // Verified payment submission — the game page's realtime listener adds
    // the player to the roster, same as a host-verified proof. The database
    // re-applies the approval and guardian rules to this row; if it refuses,
    // the money goes back and the player is not told it worked.
    const { error: insertError } = await supabaseAdmin.from("payment_submissions").insert({
      game_id: order.game_id,
      host_id: order.host_id,
      player_id: order.player_id,
      payment_method_id: null,
      payment_type: "paypal",
      screenshot_path: null,
      transaction_reference: result.captureId ?? data.orderId,
      paid_amount: order.amount_cents / 100,
      paid_at: new Date().toISOString(),
      notes: "Paid with PayPal checkout",
      status: "verified",
      reviewed_at: new Date().toISOString(),
    });
    if (insertError) {
      console.error("[paypal] captured payment could not be recorded", insertError.message);
      let refunded = false;
      if (result.captureId) {
        refunded = await refundCapture(result.captureId)
          .then(() => true)
          .catch((e) => {
            console.error("[paypal] refund after unrecorded capture failed", e);
            return false;
          });
      }
      await supabaseAdmin
        .from("paypal_orders")
        .update({
          status: refunded ? "refunded" : "unrecorded",
          capture_id: result.captureId,
          captured_at: new Date().toISOString(),
        } as never)
        .eq("order_id", data.orderId);
      throw new Error(
        refunded
          ? "Your payment couldn't be recorded, so PayPal is refunding it."
          : "Your payment couldn't be recorded. Please contact support so we can refund it.",
      );
    }

    await supabaseAdmin
      .from("paypal_orders")
      .update({
        status: "captured",
        capture_id: result.captureId,
        captured_at: new Date().toISOString(),
      })
      .eq("order_id", data.orderId);

    {
      const { addPaidPlayerToRoster } = await import("./roster-on-payment.server");
      await addPaidPlayerToRoster(order.game_id, order.player_id).catch(() => {});
    }

    // Notify the host in-app, non-blocking.
    try {
      await supabaseAdmin.from("notifications").insert({
        user_id: order.host_id,
        type: "payment_submitted",
        title: "PayPal payment received",
        body: `A player paid $${(order.amount_cents / 100).toFixed(2)} via PayPal checkout.`,
        link: `/games/${order.game_id}`,
      });
    } catch (e) {
      console.error("[paypal] host notification failed", e);
    }

    return { ok: true as const, already: false as const };
  });

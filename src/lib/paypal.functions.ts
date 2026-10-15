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
  const [{ data: game }, { data: settings }] = await Promise.all([
    admin.from("hosted_games").select("title, price, host_id").eq("id", gameId).maybeSingle(),
    admin
      .from("game_payment_settings")
      .select("entry_fee")
      .eq("game_id", gameId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!game) return null;
  const fee = Number(settings?.entry_fee ?? game.price ?? 0);
  const { data: pp } = await admin
    .from("host_paypal_accounts")
    .select("merchant_id")
    .eq("host_id", game.host_id)
    .maybeSingle();
  return {
    hostId: game.host_id as string,
    title: game.title as string | null,
    amountCents: Number.isFinite(fee) && fee > 0 ? Math.round(fee * 100) : 0,
    merchantId: pp?.merchant_id ?? null,
  };
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
    const { data: rows } = await pub.rpc("get_game_host_paypal", { _game_id: data.gameId });
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
  .inputValidator((i) =>
    z.object({ orderId: z.string().min(3).max(64) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: order } = await context.supabase
      .from("paypal_orders")
      .select("*")
      .eq("order_id", data.orderId)
      .maybeSingle();
    if (!order || order.player_id !== context.userId) throw new Error("Order not found.");
    if (order.status === "captured") return { ok: true as const, already: true as const };

    // Re-price from the game rather than trusting the stored order row.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const quote = await quoteGamePayPalFee(supabaseAdmin, order.game_id);

    const { captureOrder, getOrder, paypalPaymentMatches } = await import("@/lib/paypal.server");
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

    const result = await captureOrder(data.orderId);

    if (!paypalPaymentMatches(result, { ...expected, status: "COMPLETED" })) {
      await supabaseAdmin
        .from("paypal_orders")
        .update({ status: "failed" })
        .eq("order_id", data.orderId);
      throw new Error("PayPal payment could not be verified. No charge was recorded by us.");
    }

    await supabaseAdmin
      .from("paypal_orders")
      .update({
        status: "captured",
        capture_id: result.captureId,
        captured_at: new Date().toISOString(),
      })
      .eq("order_id", data.orderId);

    // Verified payment submission — the game page's realtime listener adds
    // the player to the roster, same as a host-verified proof.
    await supabaseAdmin.from("payment_submissions").insert({
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

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const gameIdSchema = z.object({ gameId: z.string().min(1).max(200) });

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

    const [{ data: game }, { data: settings }] = await Promise.all([
      context.supabase
        .from("hosted_games")
        .select("id, title, price, host_id, status")
        .eq("id", data.gameId)
        .maybeSingle(),
      context.supabase
        .from("game_payment_settings")
        .select("entry_fee, host_id")
        .eq("game_id", data.gameId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (!game) throw new Error("Game not found.");
    if (game.host_id === context.userId) throw new Error("You host this game.");

    const fee = Number(settings?.entry_fee ?? game.price ?? 0);
    if (!Number.isFinite(fee) || fee <= 0) throw new Error("This game is free — no payment needed.");

    const { data: pp } = await context.supabase
      .from("host_paypal_accounts")
      .select("merchant_id")
      .eq("host_id", game.host_id)
      .maybeSingle();
    if (!pp?.merchant_id) throw new Error("This host hasn't connected PayPal checkout.");

    const amountCents = Math.round(fee * 100);
    const { createOrder } = await import("@/lib/paypal.server");
    const { orderId } = await createOrder({
      amountCents,
      currency: "USD",
      merchantId: pp.merchant_id,
      description: `BallaCity: ${game.title ?? "pickup game"}`,
    });

    const { error } = await context.supabase.from("paypal_orders").insert({
      order_id: orderId,
      game_id: data.gameId,
      player_id: context.userId,
      host_id: game.host_id,
      amount_cents: amountCents,
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: hostPayPal } = await supabaseAdmin
      .from("host_paypal_accounts")
      .select("merchant_id")
      .eq("host_id", order.host_id)
      .maybeSingle();

    const { captureOrder, getOrder, paypalPaymentMatches } = await import("@/lib/paypal.server");
    const expected = {
      amountCents: order.amount_cents,
      currency: order.currency,
      merchantId: hostPayPal?.merchant_id,
    };

    // Check the approved order before capturing: once captured the money has
    // moved, so a payee or amount mismatch must stop it here.
    const pending = await getOrder(data.orderId);
    if (!paypalPaymentMatches(pending, { ...expected, status: "APPROVED" })) {
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

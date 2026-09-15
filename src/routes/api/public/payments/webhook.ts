import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";
import { tierForPriceId } from "@/lib/monetization/entitlements";

/** Seconds-since-epoch to ISO, tolerating a missing value. */
function iso(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

async function handleSubscriptionCreated(subscription: any, env: StripeEnv) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error("No userId in subscription metadata");
    return;
  }
  const item = subscription.items?.data?.[0];
  const priceId =
    item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || item?.price?.id;
  const productId = item?.price?.product;
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: subscription.customer,
      product_id: productId,
      price_id: priceId,
      status: subscription.status,
      // The entitlement tier is resolved from the price on the trusted
      // server side; it is never read from a client or from metadata.
      tier: tierForPriceId(String(priceId ?? "")),
      trial_end: iso(subscription.trial_end),
      canceled_at: iso(subscription.canceled_at),
      current_period_start: iso(periodStart),
      current_period_end: iso(periodEnd),
      environment: env,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );
}

async function handleSubscriptionUpdated(subscription: any, env: StripeEnv) {
  const item = subscription.items?.data?.[0];
  const priceId =
    item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || item?.price?.id;
  const productId = item?.price?.product;
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  await supabaseAdmin
    .from("subscriptions")
    .update({
      status: subscription.status,
      product_id: productId,
      price_id: priceId,
      tier: tierForPriceId(String(priceId ?? "")),
      trial_end: iso(subscription.trial_end),
      canceled_at: iso(subscription.canceled_at),
      current_period_start: iso(periodStart),
      current_period_end: iso(periodEnd),
      cancel_at_period_end: subscription.cancel_at_period_end || false,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);
}

async function handleSubscriptionDeleted(subscription: any, env: StripeEnv) {
  await supabaseAdmin
    .from("subscriptions")
    .update({
      status: "canceled",
      canceled_at: iso(subscription.canceled_at) ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);
}

async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  // Only record one-time payments here; subscriptions are tracked via
  // customer.subscription.* events on the subscriptions table.
  if (session.mode !== "payment") return;
  const userId = session.metadata?.userId ?? null;
  const priceId = session.metadata?.priceId;
  if (!priceId) {
    console.error("checkout.session.completed missing priceId metadata", session.id);
    return;
  }

  // Need line items to resolve product id
  let productId: string | null = null;
  try {
    const { createStripeClient } = await import("@/lib/stripe.server");
    const stripe = createStripeClient(env);
    const items = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 1,
      expand: ["data.price.product"],
    });
    const price = items.data[0]?.price as any;
    productId = typeof price?.product === "string" ? price.product : (price?.product?.id ?? null);
  } catch (e) {
    console.error("Failed to resolve product for session", session.id, e);
  }

  const shipping =
    session.shipping_details ?? session.collected_information?.shipping_details ?? null;

  await supabaseAdmin.from("purchases").upsert(
    {
      user_id: userId,
      stripe_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent ?? null,
      stripe_customer_id: session.customer ?? null,
      product_id: productId ?? "unknown",
      price_id: priceId,
      amount_total: session.amount_total ?? 0,
      currency: session.currency ?? "usd",
      quantity: 1,
      customer_email: session.customer_details?.email ?? null,
      shipping_name: shipping?.name ?? null,
      shipping_address: shipping?.address ?? null,
      status: session.payment_status === "paid" ? "paid" : (session.payment_status ?? "pending"),
      environment: env,
    },
    { onConflict: "stripe_session_id" },
  );
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);
  switch (event.type) {
    case "customer.subscription.created":
      await handleSubscriptionCreated(event.data.object, env);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object, env);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object, env);
      break;
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object, env);
      break;
    default:
      console.log("Unhandled event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          console.error("Webhook invalid env:", rawEnv);
          return Response.json({ received: true, ignored: "invalid env" });
        }
        try {
          await handleWebhook(request, rawEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});

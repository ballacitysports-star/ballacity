import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  DEFAULT_MONETIZATION_CONFIG,
  parseMonetizationOverrides,
  resolveMonetizationConfig,
  productForPriceId,
  type MonetizationConfig,
} from "./config";
import { isAccessGrantingSubscription, tierForPriceId } from "./entitlements";

/**
 * Revenue reporting for admins. Everything here is derived on the server from
 * billing records written by the signature-verified webhook, so no client can
 * influence the numbers, and access is gated on the superadmin check before a
 * single row is read.
 */

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

type SubRow = {
  user_id: string;
  price_id: string;
  tier: string | null;
  status: string;
  current_period_end: string | null;
  created_at: string | null;
  canceled_at: string | null;
};

type PurchaseRow = {
  amount_total: number;
  currency: string;
  price_id: string;
  status: string;
  created_at: string;
  user_id: string | null;
};

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("is_superadmin", { _user_id: context.userId });
  if (!data) throw new Error("Superadmin access required");
}

async function loadConfig(supabase: any): Promise<MonetizationConfig> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "monetization")
    .maybeSingle();
  return resolveMonetizationConfig(
    parseMonetizationOverrides(data?.value ?? null),
    DEFAULT_MONETIZATION_CONFIG,
  );
}

export const monetizationAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ environment: z.enum(["sandbox", "live"]).default("sandbox") })
      .parse(data ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const config = await loadConfig(context.supabase);
    const env = data.environment;
    const now = Date.now();
    const monthAgo = new Date(now - 30 * 24 * 3600 * 1000).toISOString();

    const [subsRes, purchasesRes] = await Promise.all([
      supabaseAdmin
        .from("subscriptions")
        .select("user_id,price_id,tier,status,current_period_end,created_at,canceled_at")
        .eq("environment", env),
      supabaseAdmin
        .from("purchases")
        .select("amount_total,currency,price_id,status,created_at,user_id")
        .eq("environment", env),
    ]);

    const subs = (subsRes.data ?? []) as SubRow[];
    const purchases = (purchasesRes.data ?? []) as PurchaseRow[];

    // --- Subscriptions -------------------------------------------------
    const byProduct = new Map<string, { name: string; active: number; mrrCents: number }>();
    let activeCount = 0;
    let newCount = 0;
    let cancelledCount = 0;
    let pastDueCount = 0;
    let mrrCents = 0;
    const tierMix = new Map<string, number>();
    const payingUsers = new Set<string>();

    for (const row of subs) {
      const granting = isAccessGrantingSubscription(row, now);
      if (row.canceled_at && row.canceled_at >= monthAgo) cancelledCount += 1;
      if (row.created_at && row.created_at >= monthAgo) newCount += 1;
      if (row.status === "past_due") pastDueCount += 1;
      if (!granting) continue;

      activeCount += 1;
      payingUsers.add(row.user_id);
      const tier = row.tier ?? tierForPriceId(row.price_id) ?? "unknown";
      tierMix.set(tier, (tierMix.get(tier) ?? 0) + 1);

      const product = productForPriceId(row.price_id, config);
      const key = product?.entitlement ?? row.price_id;
      const name = product?.name ?? row.price_id;
      const cents = ACTIVE_STATUSES.has(row.status) ? (product?.priceCents ?? 0) : 0;
      mrrCents += cents;
      const entry = byProduct.get(key) ?? { name, active: 0, mrrCents: 0 };
      entry.active += 1;
      entry.mrrCents += cents;
      byProduct.set(key, entry);
    }

    // --- One-time purchases -------------------------------------------
    let purchaseRevenueCents = 0;
    let purchaseRevenue30dCents = 0;
    let refundCount = 0;
    let failedCount = 0;
    let purchaseCount = 0;

    for (const row of purchases) {
      if (row.status === "refunded") {
        refundCount += 1;
        continue;
      }
      if (row.status === "failed") {
        failedCount += 1;
        continue;
      }
      purchaseCount += 1;
      purchaseRevenueCents += row.amount_total ?? 0;
      if (row.created_at >= monthAgo) purchaseRevenue30dCents += row.amount_total ?? 0;
    }

    // --- Reach: how many people are on the free network ----------------
    const [{ count: profileCount }, { count: paidGameCount }, { count: hostCount }] =
      await Promise.all([
        supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
        supabaseAdmin
          .from("game_payment_settings")
          .select("id", { count: "exact", head: true })
          .gt("entry_fee", 0),
        supabaseAdmin.from("host_payment_methods").select("id", { count: "exact", head: true }),
      ]);

    const players = profileCount ?? 0;
    return {
      environment: env,
      generatedAt: new Date(now).toISOString(),
      subscriptions: {
        active: activeCount,
        newLast30d: newCount,
        cancelledLast30d: cancelledCount,
        pastDue: pastDueCount,
        churnRate: activeCount + cancelledCount > 0
          ? cancelledCount / (activeCount + cancelledCount)
          : 0,
        mrrCents,
        tierMix: Object.fromEntries(tierMix),
        byProduct: Object.fromEntries(byProduct),
      },
      transactions: {
        count: purchaseCount,
        revenueCents: purchaseRevenueCents,
        revenueLast30dCents: purchaseRevenue30dCents,
        refunds: refundCount,
        failures: failedCount,
      },
      totals: {
        // Subscription revenue is the recurring run-rate; transaction revenue is
        // money that actually moved through platform checkout.
        revenueLast30dCents: mrrCents + purchaseRevenue30dCents,
        subscriptionShareCents: mrrCents,
        transactionShareCents: purchaseRevenue30dCents,
      },
      reach: {
        players,
        payingUsers: payingUsers.size,
        conversionRate: players > 0 ? payingUsers.size / players : 0,
        hostsWithPaymentMethods: hostCount ?? 0,
        paidGames: paidGameCount ?? 0,
      },
      // Direct host payments never generate platform revenue; surfaced so an
      // admin can see the volume without mistaking it for income.
      directHostPaymentsNote:
        "Direct host payments (Venmo, Cash App, Zelle, cash) are settled between host and player. BallaCity takes no fee and records no revenue from them.",
    };
  });

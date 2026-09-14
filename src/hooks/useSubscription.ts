import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getBillingEnvironment, isPaymentsConfigured } from "@/lib/stripe";
import { useAuth } from "@/hooks/use-auth";
import { DEFAULT_MONETIZATION_CONFIG } from "@/lib/monetization/config";
import {
  entitlementsFor,
  hasEntitlement,
  type SubscriptionLike,
} from "@/lib/monetization/entitlements";

/**
 * Reels a member may generate before ballaCity+ is required. Sourced from the
 * monetization config so the number lives in exactly one place.
 */
export const FREE_REEL_ALLOWANCE = DEFAULT_MONETIZATION_CONFIG.freeReelAllowance;

export type SubscriptionRow = {
  id: string;
  status: string;
  price_id: string;
  tier?: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  stripe_customer_id: string;
};

/**
 * Reel access, derived from the ballaCity+ entitlement rather than "has any
 * subscription", so an older reels subscriber and a new ballaCity+ member are
 * treated identically.
 */
export function useSubscription() {
  const { user } = useAuth();
  const [rows, setRows] = useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [freeUsed, setFreeUsed] = useState(0);

  useEffect(() => {
    if (!user) {
      setRows([]);
      setFreeUsed(0);
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function refetch() {
      // Deliberately not getStripeEnvironment(): the free allowance is not a
      // Stripe feature, so counting it must not depend on checkout being
      // configured. A build with no publishable key still has three free reels.
      const env = getBillingEnvironment();

      const [{ data: subRows }, { count }] = await Promise.all([
        supabase
          .from("subscriptions")
          .select(
            "id,status,price_id,tier,current_period_end,cancel_at_period_end,stripe_customer_id",
          )
          .eq("user_id", user!.id)
          .eq("environment", env)
          .order("created_at", { ascending: false }),
        supabase
          .from("highlight_reels")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id)
          .eq("environment", env)
          .eq("used_free", true),
      ]);

      if (!cancelled) {
        setRows((subRows ?? []) as SubscriptionRow[]);
        setFreeUsed(count ?? 0);
        setLoading(false);
      }
    }
    refetch();

    const channel = supabase
      .channel(`sub-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${user.id}` },
        () => refetch(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const state = entitlementsFor(rows as SubscriptionLike[]);
  const isActive = hasEntitlement(state, "player_plus");
  const isPastDue = state.pastDue;
  const sub = rows[0] ?? null;

  return {
    subscription: sub,
    isActive,
    isPastDue,
    loading,
    freeUsed,
    freeRemaining: Math.max(0, FREE_REEL_ALLOWANCE - freeUsed),
    /** False when this build has no Stripe key — nothing can be bought. */
    paymentsConfigured: isPaymentsConfigured(),
  };
}

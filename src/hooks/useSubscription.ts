import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getBillingEnvironment, isPaymentsConfigured } from "@/lib/stripe";
import { useAuth } from "@/hooks/use-auth";
import { DEFAULT_MONETIZATION_CONFIG } from "@/lib/monetization/config";
import { resolveFeatureAccess } from "@/lib/monetization/access";
import { useMonetizationConfig } from "@/hooks/useMonetizationConfig";
import { entitlementsFor, type SubscriptionLike } from "@/lib/monetization/entitlements";

/**
 * The built-in reel allowance.
 *
 * Kept as an export for back-compat only — it is frozen to the shipped default
 * and so ignores any superadmin override. Read `freeAllowance` off the hook
 * instead; that one resolves the admin-editable config.
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
 * Reel access, derived from the BallaCity+ entitlement rather than "has any
 * subscription", so an older reels subscriber and a new BallaCity+ member are
 * treated identically.
 */
export function useSubscription() {
  const { user } = useAuth();
  const { config, loading: configLoading } = useMonetizationConfig();
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

  // Both queries plus the config have to land before we can say whether reels
  // are gated at all; deciding early would flash a lock that does not apply.
  const busy = loading || configLoading;
  const state = entitlementsFor(rows as SubscriptionLike[], Date.now(), config);
  const access = resolveFeatureAccess(config, state);
  const isActive = access.has("player_plus");
  const sub = rows[0] ?? null;
  const freeAllowance = access.reelAllowance;

  return {
    subscription: sub,
    isActive,
    /** Past due only matters when something is actually being charged. */
    isPastDue: access.freeMode ? false : state.pastDue,
    loading: busy,
    freeUsed,
    /** The admin-resolved allowance. Meaningless while `unlimitedReels`. */
    freeAllowance,
    /** True when the allowance does not apply — render a word, not a number. */
    unlimitedReels: access.unlimitedReels,
    freeRemaining: access.unlimitedReels ? freeAllowance : Math.max(0, freeAllowance - freeUsed),
    access,
    /** False when this build has no Stripe key — nothing can be bought. */
    paymentsConfigured: isPaymentsConfigured(),
  };
}

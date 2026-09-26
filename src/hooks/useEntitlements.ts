import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getBillingEnvironment, isPaymentsConfigured } from "@/lib/stripe";
import { useAuth } from "@/hooks/use-auth";
import { useMonetizationConfig } from "@/hooks/useMonetizationConfig";
import {
  EMPTY_ENTITLEMENTS,
  entitlementsFor,
  hasEntitlement as hasEntitlementIn,
  type SubscriptionLike,
} from "@/lib/monetization/entitlements";
import { resolveFeatureAccess } from "@/lib/monetization/access";
import type { EntitlementKey } from "@/lib/monetization/config";

/**
 * The one place a screen asks "does this account have Host Pro / ballaCity+".
 *
 * It reads the member's own subscription rows (RLS restricts the query to their
 * own) and derives entitlements from them. Anything that actually matters is
 * also enforced server-side by `public.has_entitlement`, so this hook only
 * decides what to show, never what is allowed.
 */
export function useEntitlements() {
  const { user } = useAuth();
  const { config, loading: configLoading } = useMonetizationConfig();
  const [rows, setRows] = useState<SubscriptionLike[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function refetch() {
      // Not getStripeEnvironment(): reading which plan someone is on must work
      // on a build that cannot sell anything.
      const env = getBillingEnvironment();
      const { data } = await supabase
        .from("subscriptions")
        .select("status,price_id,tier,current_period_end")
        .eq("user_id", user!.id)
        .eq("environment", env);
      if (!cancelled) {
        setRows((data ?? []) as SubscriptionLike[]);
        setLoading(false);
      }
    }
    refetch();

    const channel = supabase
      // Unique per mount: several screens can use this hook at once, and a
      // shared channel name returns an already-subscribed channel that throws.
      .channel(`entitlements-${user.id}-${Math.random().toString(36).slice(2, 10)}`)
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

  // Until the config has loaded we do not know whether billing is even on, so
  // treat the whole hook as loading. Deciding early would flash the wrong state.
  const busy = loading || configLoading;
  const state = busy ? EMPTY_ENTITLEMENTS : entitlementsFor(rows, Date.now(), config);
  const access = resolveFeatureAccess(config, state);

  return {
    loading: busy,
    /** The raw derivation from subscription rows — what billing actually sees. */
    state,
    /** The centralized gate. True for everything while ballaCity is free. */
    has: (key: EntitlementKey) => access.has(key),
    /** True when the account really holds it, ignoring free mode. */
    hasPaid: (key: EntitlementKey) => hasEntitlementIn(state, key),
    access,
    /** Past due only matters when something is actually being charged. */
    pastDue: access.freeMode ? false : state.pastDue,
    /** False when this build has no billing key — nothing can be bought. */
    paymentsConfigured: isPaymentsConfigured(),
  };
}

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
  const { config } = useMonetizationConfig();
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
      .channel(`entitlements-${user.id}`)
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

  const state = loading ? EMPTY_ENTITLEMENTS : entitlementsFor(rows, Date.now(), config);

  return {
    loading,
    state,
    has: (key: EntitlementKey) => hasEntitlementIn(state, key),
    pastDue: state.pastDue,
    /** False when this build has no billing key — nothing can be bought. */
    paymentsConfigured: isPaymentsConfigured(),
  };
}

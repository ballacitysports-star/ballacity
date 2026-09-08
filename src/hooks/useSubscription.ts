import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getBillingEnvironment, isPaymentsConfigured } from "@/lib/stripe";
import { useAuth } from "@/hooks/use-auth";

/** Reels a member may generate before a subscription is required. */
export const FREE_REEL_ALLOWANCE = 3;

export type SubscriptionRow = {
  id: string;
  status: string;
  price_id: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  stripe_customer_id: string;
};

export function useSubscription() {
  const { user } = useAuth();
  const [sub, setSub] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [freeUsed, setFreeUsed] = useState(0);

  useEffect(() => {
    if (!user) {
      setSub(null);
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

      const [{ data: subRow }, { count }] = await Promise.all([
        supabase
          .from("subscriptions")
          .select("id,status,price_id,current_period_end,cancel_at_period_end,stripe_customer_id")
          .eq("user_id", user!.id)
          .eq("environment", env)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("highlight_reels")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id)
          .eq("environment", env)
          .eq("used_free", true),
      ]);

      if (!cancelled) {
        setSub(subRow as SubscriptionRow | null);
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

  const now = Date.now();
  const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end).getTime() : null;
  const isActive =
    !!sub &&
    ((["active", "trialing", "past_due"].includes(sub.status) && (!periodEnd || periodEnd > now)) ||
      (sub.status === "canceled" && periodEnd !== null && periodEnd > now));
  const isPastDue = sub?.status === "past_due";

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

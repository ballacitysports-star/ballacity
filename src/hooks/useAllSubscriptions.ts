import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getBillingEnvironment } from "@/lib/stripe";
import { useAuth } from "@/hooks/use-auth";

type SubRow = {
  id: string;
  status: string;
  price_id: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  stripe_customer_id: string;
};

function isActiveRow(s: SubRow): boolean {
  const now = Date.now();
  const periodEnd = s.current_period_end ? new Date(s.current_period_end).getTime() : null;
  return (
    (["active", "trialing", "past_due"].includes(s.status) && (!periodEnd || periodEnd > now)) ||
    (s.status === "canceled" && periodEnd !== null && periodEnd > now)
  );
}

export function useAllSubscriptions() {
  const { user } = useAuth();
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setSubs([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function refetch() {
      // Reading which plans someone is on must work even on a build that
      // cannot sell anything; see getBillingEnvironment().
      const env = getBillingEnvironment();
      const { data } = await supabase
        .from("subscriptions")
        .select("id,status,price_id,current_period_end,cancel_at_period_end,stripe_customer_id")
        .eq("user_id", user!.id)
        .eq("environment", env)
        .order("created_at", { ascending: false });
      if (!cancelled) {
        setSubs((data ?? []) as SubRow[]);
        setLoading(false);
      }
    }
    refetch();
    const channel = supabase
      .channel(`subs-all-${user.id}`)
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

  // Most recent active row per price_id
  const activeByPrice = new Map<string, SubRow>();
  for (const s of subs) {
    if (isActiveRow(s) && !activeByPrice.has(s.price_id)) activeByPrice.set(s.price_id, s);
  }

  return {
    loading,
    subscriptions: subs,
    hasActive: (priceId: string) => activeByPrice.has(priceId),
    activeFor: (priceId: string) => activeByPrice.get(priceId) ?? null,
    anyActiveCustomerId: () =>
      subs.find((s) => isActiveRow(s))?.stripe_customer_id ?? subs[0]?.stripe_customer_id ?? null,
  };
}

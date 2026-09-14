import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_MONETIZATION_CONFIG,
  parseMonetizationOverrides,
  resolveMonetizationConfig,
  type MonetizationConfig,
} from "@/lib/monetization/config";

/**
 * Prices, fees and trial lengths, with any superadmin override applied.
 *
 * The overrides live in the public `app_settings.monetization` row — they are
 * prices, not personal data, so everyone may read them and only a superadmin
 * may write them (enforced by RLS). Server code resolves the same row, so
 * client and server always quote the same numbers.
 */
export async function fetchMonetizationConfig(): Promise<MonetizationConfig> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "monetization")
    .maybeSingle();
  if (error || !data) return DEFAULT_MONETIZATION_CONFIG;
  return resolveMonetizationConfig(
    parseMonetizationOverrides((data as { value: unknown }).value),
  );
}

export function useMonetizationConfig() {
  const q = useQuery({
    queryKey: ["monetization-config"],
    queryFn: fetchMonetizationConfig,
    staleTime: 5 * 60_000,
  });
  return { config: q.data ?? DEFAULT_MONETIZATION_CONFIG, loading: q.isLoading };
}

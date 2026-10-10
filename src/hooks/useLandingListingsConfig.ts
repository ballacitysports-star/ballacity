import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_LANDING_LISTINGS,
  LANDING_LISTINGS_SETTING_KEY,
  parseLandingListings,
  resolveLandingVisibility,
  type LandingListingsConfig,
} from "@/lib/landing-listings";

/**
 * Landing-page listing toggles, read from the public
 * `app_settings.landing_listings` row. Falls back to "show everything" when the
 * row is missing or unreadable so a failed fetch never blanks the page.
 */
export async function fetchLandingListingsConfig(): Promise<LandingListingsConfig> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", LANDING_LISTINGS_SETTING_KEY)
    .maybeSingle();
  if (error || !data) return DEFAULT_LANDING_LISTINGS;
  return parseLandingListings((data as { value: unknown }).value);
}

export function useLandingListingsConfig() {
  const q = useQuery({
    queryKey: ["landing-listings-config"],
    queryFn: fetchLandingListingsConfig,
    staleTime: 5 * 60_000,
  });
  const config = q.data ?? DEFAULT_LANDING_LISTINGS;
  return { config, visible: resolveLandingVisibility(config), loading: q.isLoading };
}

/**
 * Which live, user-generated blocks the public landing page shows.
 *
 * Stored in the public `app_settings.landing_listings` row (superadmin write,
 * public read via RLS). A missing row or missing/invalid field means "show", so
 * the landing page behaves exactly as before until a superadmin turns
 * something off.
 */
export const LANDING_LISTINGS_SETTING_KEY = "landing_listings";

export type LandingListingsConfig = {
  /** Master switch: off hides every live listing block below. */
  showLiveListings: boolean;
  showPickupGames: boolean;
  showTryouts: boolean;
  showAvailability: boolean;
  showTrainerSpotlight: boolean;
};

export const DEFAULT_LANDING_LISTINGS: LandingListingsConfig = {
  showLiveListings: true,
  showPickupGames: true,
  showTryouts: true,
  showAvailability: true,
  showTrainerSpotlight: true,
};

export function parseLandingListings(value: unknown): LandingListingsConfig {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out = { ...DEFAULT_LANDING_LISTINGS };
  for (const k of Object.keys(out) as (keyof LandingListingsConfig)[]) {
    if (typeof raw[k] === "boolean") out[k] = raw[k] as boolean;
  }
  return out;
}

/** Effective visibility of each block once the master switch is applied. */
export function resolveLandingVisibility(c: LandingListingsConfig) {
  const on = c.showLiveListings;
  return {
    pickupGames: on && c.showPickupGames,
    tryouts: on && c.showTryouts,
    availability: on && c.showAvailability,
    trainerSpotlight: on && c.showTrainerSpotlight,
  };
}

/**
 * Who is entitled to what — derived, never asserted.
 *
 * The only input is subscription rows written by the signature-verified billing
 * webhook (or the equivalent SQL check `public.has_entitlement`). Nothing a
 * member can change in their own browser can grant a paid entitlement, and no
 * screen may keep its own idea of "is subscribed".
 */

import {
  DEFAULT_MONETIZATION_CONFIG,
  productForPriceId,
  type EntitlementKey,
  type MonetizationConfig,
} from "./config";

export type SubscriptionLike = {
  status: string;
  price_id: string;
  tier?: string | null;
  current_period_end?: string | null;
};

export type EntitlementState = {
  entitlements: Set<EntitlementKey>;
  /** True while billing is failing but access is still granted. */
  pastDue: boolean;
};

const ACCESS_GRANTING_STATUSES = ["active", "trialing", "past_due"];

/**
 * A subscription grants access while it is live, and also after cancellation
 * until the period the member already paid for runs out.
 */
export function isAccessGrantingSubscription(row: SubscriptionLike, now: number = Date.now()) {
  const end = row.current_period_end ? new Date(row.current_period_end).getTime() : null;
  if (ACCESS_GRANTING_STATUSES.includes(row.status)) return end === null || end > now;
  if (row.status === "canceled") return end !== null && end > now;
  return false;
}

export function tierForPriceId(
  priceId: string,
  config: MonetizationConfig = DEFAULT_MONETIZATION_CONFIG,
): EntitlementKey | null {
  return productForPriceId(priceId, config)?.entitlement ?? null;
}

export function entitlementsFor(
  rows: SubscriptionLike[],
  now: number = Date.now(),
  config: MonetizationConfig = DEFAULT_MONETIZATION_CONFIG,
): EntitlementState {
  const entitlements = new Set<EntitlementKey>();
  let pastDue = false;
  for (const row of rows) {
    if (!isAccessGrantingSubscription(row, now)) continue;
    // `tier` is what the webhook recorded; the price map is the fallback so
    // rows written before tiers existed keep working.
    const key = (row.tier as EntitlementKey | null) ?? tierForPriceId(row.price_id, config);
    if (!key) continue;
    entitlements.add(key);
    if (row.status === "past_due") pastDue = true;
  }
  return { entitlements, pastDue };
}

export function hasEntitlement(state: EntitlementState, key: EntitlementKey): boolean {
  return state.entitlements.has(key);
}

export const EMPTY_ENTITLEMENTS: EntitlementState = { entitlements: new Set(), pastDue: false };

/**
 * Capabilities that must stay free forever. Anything listed here failing a
 * free-account check is a bug, not a paywall.
 */
export const ALWAYS_FREE_CAPABILITIES = [
  "create_account",
  "edit_profile",
  "discover_games",
  "search_and_filter",
  "view_game_details",
  "join_game",
  "host_game",
  "messaging",
  "availability",
  "teams",
  "reputation",
  "notifications",
] as const;

export type AlwaysFreeCapability = (typeof ALWAYS_FREE_CAPABILITIES)[number];

/** Free capabilities never consult entitlements. */
export function requiresEntitlement(capability: string): boolean {
  return !(ALWAYS_FREE_CAPABILITIES as readonly string[]).includes(capability);
}

/**
 * The one place that decides whether a feature is locked.
 *
 * Every screen, hook and server function asks this module — none of them keeps
 * its own idea of "is this account paid". That matters because BallaCity is
 * currently free for everyone: `access.platformFreeMode` is true in the shipped
 * config, so `has()` grants every entitlement and no paywall, checkout or
 * upgrade prompt may render.
 *
 * Nothing is deleted while free mode is on. Products, prices, Stripe wiring and
 * the billing webhook all stay live, and a superadmin switching free mode off
 * in the Monetization panel — then enabling the surfaces they want — restores
 * the paid product. That reversibility is what this indirection buys.
 */

import {
  DEFAULT_MONETIZATION_CONFIG,
  type EntitlementKey,
  type MonetizationAiTier,
  type MonetizationConfig,
} from "./config";
import { EMPTY_ENTITLEMENTS, hasEntitlement, type EntitlementState } from "./entitlements";

export type FeatureAccess = {
  /** True while BallaCity is free for everyone. */
  freeMode: boolean;
  /** Does this account hold the entitlement? Always true in free mode. */
  has: (key: EntitlementKey) => boolean;
  /** May any upgrade CTA, upsell banner or paywall copy render? */
  showUpgradePrompts: boolean;
  /** May a checkout session be opened at all? */
  canCheckout: boolean;
  /** Is the merch shop reachable? */
  merchEnabled: boolean;
  /**
   * True when the reel allowance does not apply. Callers must render a word
   * ("Unlimited"), never a number — there is no numeric allowance to show.
   */
  unlimitedReels: boolean;
  /** The allowance when it does apply. Meaningless while `unlimitedReels`. */
  reelAllowance: number;
  /** AI limit tier to apply, or null to derive it from real entitlements. */
  aiTierOverride: MonetizationAiTier | null;
  /** Copy to show where a paywall used to be. */
  notice: string;
  /**
   * ISO date the free run is advertised until, or null.
   *
   * Null once the date has passed: the countdown stops and the platform stays
   * free. Screens ask `freeUntil != null` rather than each re-deriving "is it
   * still in the future", which is where two surfaces would otherwise drift
   * into telling a member different things.
   */
  freeUntil: string | null;
};

/**
 * The advertised end date, but only while it is still ahead of us.
 *
 * Deliberately returns null rather than throwing or passing a bad value
 * through: a malformed date is an admin typo, and the right response is to
 * stop advertising an end, never to stop being free.
 */
function upcomingFreeUntil(endsAt: string | null, now: number): string | null {
  if (!endsAt) return null;
  const at = Date.parse(endsAt);
  if (!Number.isFinite(at) || at <= now) return null;
  return endsAt;
}

export function resolveFeatureAccess(
  config: MonetizationConfig = DEFAULT_MONETIZATION_CONFIG,
  state: EntitlementState = EMPTY_ENTITLEMENTS,
  now: number = Date.now(),
): FeatureAccess {
  const access = config.access ?? DEFAULT_MONETIZATION_CONFIG.access;
  const freeMode = access.platformFreeMode;

  if (freeMode) {
    const granted = new Set(access.freeModeEntitlements);
    return {
      freeMode: true,
      has: (key) => granted.has(key),
      showUpgradePrompts: false,
      canCheckout: false,
      merchEnabled: false,
      unlimitedReels: true,
      reelAllowance: config.freeReelAllowance,
      aiTierOverride: access.freeModeAiTier,
      notice: access.freeModeNotice,
      freeUntil: upcomingFreeUntil(access.freeModeEndsAt ?? null, now),
    };
  }

  return {
    freeMode: false,
    has: (key) => hasEntitlement(state, key),
    showUpgradePrompts: access.upgradePromptsEnabled,
    // Checkout needs both the payment rails and something to sell.
    canCheckout:
      access.checkoutEnabled &&
      access.paymentsEnabled &&
      (access.subscriptionsEnabled || access.merchShopEnabled),
    merchEnabled: access.merchShopEnabled,
    unlimitedReels: false,
    reelAllowance: config.freeReelAllowance,
    aiTierOverride: null,
    notice: "",
    // Nothing is free, so there is no free run to advertise an end for.
    freeUntil: null,
  };
}

/**
 * Whether a checkout session may be opened for one specific price.
 *
 * Subscriptions and merch are switched independently, so "can check out at all"
 * is not enough to authorise a given purchase.
 */
export function canCheckoutPrice(
  config: MonetizationConfig,
  priceId: string,
  isMerch: boolean,
): boolean {
  const access = config.access ?? DEFAULT_MONETIZATION_CONFIG.access;
  if (access.platformFreeMode) return false;
  if (!access.checkoutEnabled || !access.paymentsEnabled) return false;
  return isMerch ? access.merchShopEnabled : access.subscriptionsEnabled;
}

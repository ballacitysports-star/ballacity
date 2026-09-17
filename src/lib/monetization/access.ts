/**
 * The one place that decides whether a feature is locked.
 *
 * Every screen, hook and server function asks this module — none of them keeps
 * its own idea of "is this account paid". That matters because ballaCity is
 * currently free for everyone: `access.billingEnabled` is false in the shipped
 * config, so `has()` grants every entitlement and no paywall, checkout or
 * upgrade prompt may render.
 *
 * Nothing is deleted while free mode is on. Products, prices, Stripe wiring and
 * the billing webhook all stay live, and a superadmin flipping `billingEnabled`
 * back on in the Monetization panel restores the paid product exactly as it
 * was. That reversibility is what this indirection buys.
 */

import {
  DEFAULT_MONETIZATION_CONFIG,
  type EntitlementKey,
  type MonetizationAiTier,
  type MonetizationConfig,
} from "./config";
import { EMPTY_ENTITLEMENTS, hasEntitlement, type EntitlementState } from "./entitlements";

export type FeatureAccess = {
  /** True while ballaCity is free for everyone. */
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
};

export function resolveFeatureAccess(
  config: MonetizationConfig = DEFAULT_MONETIZATION_CONFIG,
  state: EntitlementState = EMPTY_ENTITLEMENTS,
): FeatureAccess {
  const access = config.access ?? DEFAULT_MONETIZATION_CONFIG.access;
  const freeMode = !access.billingEnabled;

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
    };
  }

  return {
    freeMode: false,
    has: (key) => hasEntitlement(state, key),
    showUpgradePrompts: access.upgradePromptsEnabled,
    canCheckout: access.subscriptionsEnabled || access.merchShopEnabled,
    merchEnabled: access.merchShopEnabled,
    unlimitedReels: false,
    reelAllowance: config.freeReelAllowance,
    aiTierOverride: null,
    notice: "",
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
  if (!access.billingEnabled) return false;
  return isMerch ? access.merchShopEnabled : access.subscriptionsEnabled;
}

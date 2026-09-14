/**
 * Thin view over the monetization config so older screens keep working.
 * New code should read `@/lib/monetization/config` (or `useMonetizationConfig`
 * for admin-overridden prices) directly.
 */
import {
  DEFAULT_MONETIZATION_CONFIG,
  FREE_TIER_FEATURES,
  liveProducts,
  priceLabelFor,
  type MonetizationConfig,
  type MonetizationProduct,
} from "@/lib/monetization/config";

export type PlanTier = {
  priceId: string;
  name: string;
  tagline: string;
  priceLabel: string;
  features: string[];
  cta: string;
  highlight?: boolean;
};

export const FREE_TIER: PlanTier = {
  priceId: "free",
  name: "Free",
  tagline: "Everything you need to start playing",
  priceLabel: "$0",
  features: FREE_TIER_FEATURES,
  cta: "Included",
};

export function planTierFor(product: MonetizationProduct): PlanTier {
  return {
    priceId: product.priceId,
    name: product.name,
    tagline: product.tagline,
    priceLabel: priceLabelFor(product),
    features: product.features,
    cta: product.cta,
    ...(product.highlight ? { highlight: true } : {}),
  };
}

export function planTiersFrom(config: MonetizationConfig): PlanTier[] {
  return liveProducts(config).map(planTierFor);
}

/** Default-priced plans, for code that cannot await the admin overrides. */
export const PLAN_TIERS: PlanTier[] = planTiersFrom(DEFAULT_MONETIZATION_CONFIG);

export type MerchItem = {
  priceId: string;
  name: string;
  description: string;
  priceLabel: string;
  emoji: string;
};

export const MERCH_ITEMS: MerchItem[] = [
  {
    priceId: "merch_tee_onetime",
    name: "Logo Tee",
    description: "Soft cotton tee with embroidered logo",
    priceLabel: "$25",
    emoji: "👕",
  },
  {
    priceId: "merch_hoodie_onetime",
    name: "Pullover Hoodie",
    description: "Heavyweight pullover with logo",
    priceLabel: "$55",
    emoji: "🧥",
  },
  {
    priceId: "merch_hat_onetime",
    name: "Snapback Hat",
    description: "Adjustable snapback with embroidered logo",
    priceLabel: "$20",
    emoji: "🧢",
  },
];

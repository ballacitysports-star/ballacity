/**
 * The single source of truth for everything ballaCity charges for.
 *
 * No price, fee, trial length or feature list may be written into a screen or a
 * server function: they all live here, and a superadmin can override the
 * numbers at runtime through the `monetization` row in `app_settings` (see
 * `parseMonetizationOverrides`) without a deploy.
 *
 * `priceId` values are Stripe *lookup keys*, resolved by
 * `createCheckoutSession`. `legacyPriceIds` keeps every identifier we have ever
 * sold under, so an existing subscriber never loses access when a product is
 * renamed.
 */

export type EntitlementKey =
  | "player_plus"
  | "host_pro"
  | "team_pro"
  | "org_pro"
  | "facility_pro";

/** `live` products can be bought today; `reserved` ones exist as slots only. */
export type ProductStatus = "live" | "reserved";

export type MonetizationProduct = {
  priceId: string;
  legacyPriceIds: string[];
  entitlement: EntitlementKey;
  name: string;
  tagline: string;
  /** Display price in cents. The real charge is whatever the price says. */
  priceCents: number;
  interval: "month";
  trialDays: number;
  features: string[];
  cta: string;
  status: ProductStatus;
  highlight?: boolean;
};

export type FeeConfig = {
  /** ballaCity's cut, in basis points, on payments ballaCity processes. */
  platformFeeBps: number;
  /** Card processing, in basis points plus a fixed amount. */
  processingFeeBps: number;
  processingFeeFixedCents: number;
  /** Floor and ceiling for the platform fee, in cents. */
  minPlatformFeeCents: number;
  maxPlatformFeeCents: number;
};

export type MonetizationConfig = {
  products: MonetizationProduct[];
  fees: FeeConfig;
  /** AI reels every member gets before ballaCity+ is required. */
  freeReelAllowance: number;
  /**
   * Whether ballaCity can process game fees itself. False until a processor is
   * genuinely wired up — we never present a payment path that does not exist.
   */
  ballacityProcessedPaymentsEnabled: boolean;
};

export const DEFAULT_MONETIZATION_CONFIG: MonetizationConfig = {
  freeReelAllowance: 3,
  ballacityProcessedPaymentsEnabled: false,
  fees: {
    platformFeeBps: 500,
    processingFeeBps: 290,
    processingFeeFixedCents: 30,
    minPlatformFeeCents: 50,
    maxPlatformFeeCents: 2500,
  },
  products: [
    {
      priceId: "ai_highlight_reel_monthly",
      legacyPriceIds: ["ballacity_plus_monthly"],
      entitlement: "player_plus",
      name: "ballaCity+",
      tagline: "For players who want the full toolkit",
      priceCents: 999,
      interval: "month",
      trialDays: 0,
      features: [
        "Unlimited AI highlight reels",
        "Advanced discovery filters",
        "Member badge on your profile",
        "Advanced stats & availability",
        "Recruiting visibility",
      ],
      cta: "Get ballaCity+",
      status: "live",
    },
    {
      priceId: "host_subscription_monthly",
      legacyPriceIds: ["host_pro_monthly"],
      entitlement: "host_pro",
      name: "Host Pro",
      tagline: "For organizers running games regularly",
      priceCents: 1999,
      interval: "month",
      trialDays: 0,
      features: [
        "Unlimited game listings",
        "Recurring games & waitlists",
        "Automatic payment reminders",
        "Attendance & no-show tracking",
        "Host analytics with fee totals",
        "Private games & featured placement",
      ],
      cta: "Become a Host Pro",
      status: "live",
      highlight: true,
    },
    {
      priceId: "team_plan_monthly",
      legacyPriceIds: ["team_pro_monthly"],
      entitlement: "team_pro",
      name: "Team",
      tagline: "Up to 10 players, shared team page",
      priceCents: 4900,
      interval: "month",
      trialDays: 0,
      features: ["Unlimited reels for 10 players", "Shared team page", "Captain controls"],
      cta: "Start Team plan",
      status: "live",
    },
    {
      priceId: "org_plan_monthly",
      legacyPriceIds: ["org_pro_monthly"],
      entitlement: "org_pro",
      name: "Organization",
      tagline: "For clubs and larger orgs",
      priceCents: 9900,
      interval: "month",
      trialDays: 0,
      features: ["Up to 25 players", "Branded team page", "Priority support"],
      cta: "Start Org plan",
      status: "live",
    },
    {
      // Reserved slot: nothing is sold until a facility surface exists.
      priceId: "facility_plan_monthly",
      legacyPriceIds: [],
      entitlement: "facility_pro",
      name: "Facility",
      tagline: "For gyms, fields and venues",
      priceCents: 4900,
      interval: "month",
      trialDays: 0,
      features: ["Claimed venue page", "Booking enquiries", "Venue analytics"],
      cta: "Contact us",
      status: "reserved",
    },
  ],
};

/** Everything a member gets without paying anything, ever. */
export const FREE_TIER_FEATURES: string[] = [
  "Create your player profile & availability",
  "Discover, search and filter games",
  "Request to join and host games",
  "Messaging & notifications",
  "Teams, reputation and reviews",
  "3 free AI highlight reels",
];

export type MonetizationOverrides = {
  prices?: Record<string, number>;
  trials?: Record<string, number>;
  fees?: Partial<FeeConfig>;
  freeReelAllowance?: number;
  ballacityProcessedPaymentsEnabled?: boolean;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Reads the admin-editable `app_settings.monetization` blob defensively. */
export function parseMonetizationOverrides(raw: unknown): MonetizationOverrides {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: MonetizationOverrides = {};

  for (const key of ["prices", "trials"] as const) {
    const src = o[key];
    if (src && typeof src === "object") {
      const map: Record<string, number> = {};
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        const n = num(v);
        if (n !== null) map[k] = Math.round(n);
      }
      if (Object.keys(map).length > 0) out[key] = map;
    }
  }

  if (o["fees"] && typeof o["fees"] === "object") {
    const src = o["fees"] as Record<string, unknown>;
    const fees: Partial<FeeConfig> = {};
    for (const k of [
      "platformFeeBps",
      "processingFeeBps",
      "processingFeeFixedCents",
      "minPlatformFeeCents",
      "maxPlatformFeeCents",
    ] as const) {
      const n = num(src[k]);
      if (n !== null) fees[k] = Math.round(n);
    }
    if (Object.keys(fees).length > 0) out.fees = fees;
  }

  const allowance = num(o["freeReelAllowance"]);
  if (allowance !== null) out.freeReelAllowance = Math.round(allowance);
  if (typeof o["ballacityProcessedPaymentsEnabled"] === "boolean") {
    out.ballacityProcessedPaymentsEnabled = o["ballacityProcessedPaymentsEnabled"];
  }
  return out;
}

/** Applies admin overrides on top of the built-in defaults. */
export function resolveMonetizationConfig(
  overrides: MonetizationOverrides | null | undefined,
  base: MonetizationConfig = DEFAULT_MONETIZATION_CONFIG,
): MonetizationConfig {
  if (!overrides) return base;
  return {
    ...base,
    freeReelAllowance: overrides.freeReelAllowance ?? base.freeReelAllowance,
    ballacityProcessedPaymentsEnabled:
      overrides.ballacityProcessedPaymentsEnabled ?? base.ballacityProcessedPaymentsEnabled,
    fees: { ...base.fees, ...(overrides.fees ?? {}) },
    products: base.products.map((p) => ({
      ...p,
      priceCents: overrides.prices?.[p.priceId] ?? p.priceCents,
      trialDays: overrides.trials?.[p.priceId] ?? p.trialDays,
    })),
  };
}

export function formatPriceCents(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export function priceLabelFor(product: MonetizationProduct): string {
  return `${formatPriceCents(product.priceCents)}/mo`;
}

export function liveProducts(config: MonetizationConfig): MonetizationProduct[] {
  return config.products.filter((p) => p.status === "live");
}

export function productForPriceId(
  priceId: string,
  config: MonetizationConfig = DEFAULT_MONETIZATION_CONFIG,
): MonetizationProduct | null {
  return (
    config.products.find((p) => p.priceId === priceId || p.legacyPriceIds.includes(priceId)) ?? null
  );
}

export function productForEntitlement(
  entitlement: EntitlementKey,
  config: MonetizationConfig = DEFAULT_MONETIZATION_CONFIG,
): MonetizationProduct | null {
  return config.products.find((p) => p.entitlement === entitlement) ?? null;
}

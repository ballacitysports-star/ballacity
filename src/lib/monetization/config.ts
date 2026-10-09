/**
 * The single source of truth for everything BallaCity charges for.
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
  /** BallaCity's cut, in basis points, on payments BallaCity processes. */
  platformFeeBps: number;
  /** Card processing, in basis points plus a fixed amount. */
  processingFeeBps: number;
  processingFeeFixedCents: number;
  /** Floor and ceiling for the platform fee, in cents. */
  minPlatformFeeCents: number;
  maxPlatformFeeCents: number;
};

/**
 * AI limit tiers, mirrored from `@/lib/ai/config` rather than imported so the
 * monetization package carries no AI knowledge. The AI layer narrows this
 * against its own `AI_TIERS` at the single call site.
 */
export type MonetizationAiTier = "free" | "premium" | "team" | "gym";

/**
 * Everything BallaCity charges for, and whether it is charging at all.
 *
 * While `platformFreeMode` is true the platform is free for everyone: nothing
 * is purchasable, no paywall, checkout, upgrade prompt or premium lock blocks
 * anyone, every account holds every entitlement, and a feature configured as
 * `premium` is served as `free`. Nothing is deleted — the products, prices,
 * Stripe wiring and webhook all stay exactly as they are.
 *
 * `/plans` still shows the real plans while free, with their normal prices
 * struck through and nothing to buy, so members can see what they are getting.
 * That is presentation, not a paywall: no card offers a purchase.
 *
 * Free mode governs PAYMENT only. It can never widen an age, guardian, safety,
 * moderation, privacy or legal restriction; `canAccessFeature` evaluates those
 * first and short-circuits before any of this is consulted.
 *
 * The switches below are only reached once `platformFreeMode` is false.
 */

/** How a single feature is priced. */
export type FeatureAccessMode = "free" | "premium" | "disabled";

export const FEATURE_ACCESS_MODES: FeatureAccessMode[] = ["free", "premium", "disabled"];

export type MonetizationAccess = {
  /**
   * The master switch. True means BallaCity is free for everyone and every
   * feature configured as `premium` is served as `free`.
   */
  platformFreeMode: boolean;

  /**
   * The global controls. All default OFF, so monetization is re-enabled
   * deliberately, one surface at a time, rather than all at once by a single
   * mis-click.
   */
  subscriptionsEnabled: boolean;
  paymentsEnabled: boolean;
  premiumFeaturesEnabled: boolean;
  checkoutEnabled: boolean;
  merchShopEnabled: boolean;
  upgradePromptsEnabled: boolean;

  /** Entitlements every account holds while free mode is on. */
  freeModeEntitlements: EntitlementKey[];
  /** AI limit tier every account resolves to while free mode is on. */
  freeModeAiTier: MonetizationAiTier;
  /** Copy shown where a paywall used to be. */
  freeModeNotice: string;
  /**
   * Optional ISO date the free run is advertised until.
   *
   * MESSAGING ONLY. Nothing switches itself off when it passes — the countdown
   * simply stops and the platform stays free. Monetization only ever starts
   * because a superadmin turned it on, so a typo in this field cannot begin
   * gating members.
   */
  freeModeEndsAt: string | null;

  /**
   * Per-feature pricing. A feature that is not listed is `free`, so adding a
   * feature to the registry never silently locks it.
   */
  featureAccess: Record<string, FeatureAccessMode>;
};

export type MonetizationConfig = {
  products: MonetizationProduct[];
  fees: FeeConfig;
  /** AI reels every member gets before BallaCity+ is required. */
  freeReelAllowance: number;
  /**
   * Whether BallaCity can process game fees itself. False until a processor is
   * genuinely wired up — we never present a payment path that does not exist.
   */
  ballacityProcessedPaymentsEnabled: boolean;
  access: MonetizationAccess;
};

export const ALL_ENTITLEMENTS: EntitlementKey[] = [
  "player_plus",
  "host_pro",
  "team_pro",
  "org_pro",
  "facility_pro",
];

export const MONETIZATION_AI_TIERS: MonetizationAiTier[] = ["free", "premium", "team", "gym"];

export const DEFAULT_MONETIZATION_CONFIG: MonetizationConfig = {
  freeReelAllowance: 3,
  ballacityProcessedPaymentsEnabled: false,
  // BallaCity ships free, and every paid surface ships off. Turning free mode
  // off is therefore not enough to start charging: each surface has to be
  // switched on deliberately, so monetization can be staged rather than
  // arriving all at once.
  access: {
    platformFreeMode: true,
    subscriptionsEnabled: false,
    paymentsEnabled: false,
    premiumFeaturesEnabled: false,
    checkoutEnabled: false,
    merchShopEnabled: false,
    upgradePromptsEnabled: false,
    freeModeEntitlements: ["player_plus", "host_pro", "team_pro", "org_pro", "facility_pro"],
    freeModeAiTier: "gym",
    freeModeNotice: "Everything on BallaCity is free right now — no subscription needed.",
    freeModeEndsAt: null,
    featureAccess: {},
  },
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
      name: "BallaCity+",
      tagline: "For players who want the full toolkit",
      priceCents: 999,
      interval: "month",
      trialDays: 0,
      // Only capabilities that actually exist. Several strings that used to be
      // here ("Member badge on your profile", "Advanced discovery filters",
      // "Advanced stats & availability", "Recruiting visibility") had no
      // implementation behind them — see docs/monetization-free-mode.md. Free
      // mode renders the union of every product's features, so an unbuilt claim
      // would now be promised to every member.
      features: ["Unlimited AI highlight reels", "AI reel coach, styles and captions"],
      cta: "Get BallaCity+",
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
const FREE_TIER_BASE_FEATURES: string[] = [
  "Create your player profile & availability",
  "Discover, search and filter games",
  "Request to join and host games",
  "Messaging & notifications",
  "Teams, reputation and reviews",
];

/**
 * The free-tier list, with the reel line derived rather than hardcoded.
 *
 * The count follows the resolved allowance, and while BallaCity is free it
 * reads "Unlimited" — otherwise the page would promise unlimited reels at the
 * top and "3 free" three lines below.
 */
export function freeTierFeatures(
  config: MonetizationConfig = DEFAULT_MONETIZATION_CONFIG,
): string[] {
  const reels = config.access?.platformFreeMode
    ? "Unlimited AI highlight reels"
    : `${config.freeReelAllowance} free AI highlight reels`;
  return [...FREE_TIER_BASE_FEATURES, reels];
}

/** Default-config view, for code that cannot resolve the admin overrides. */
export const FREE_TIER_FEATURES: string[] = freeTierFeatures();

export type MonetizationOverrides = {
  prices?: Record<string, number>;
  trials?: Record<string, number>;
  fees?: Partial<FeeConfig>;
  freeReelAllowance?: number;
  ballacityProcessedPaymentsEnabled?: boolean;
  access?: Partial<MonetizationAccess>;
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

  if (o["access"] && typeof o["access"] === "object") {
    const src = o["access"] as Record<string, unknown>;
    const access: Partial<MonetizationAccess> = {};

    for (const k of [
      "platformFreeMode",
      "subscriptionsEnabled",
      "paymentsEnabled",
      "premiumFeaturesEnabled",
      "checkoutEnabled",
      "merchShopEnabled",
      "upgradePromptsEnabled",
    ] as const) {
      if (typeof src[k] === "boolean") access[k] = src[k] as boolean;
    }

    // A row written before the rename still carries `billingEnabled`, which is
    // the inverse. An explicit `platformFreeMode` always wins.
    if (access.platformFreeMode === undefined && typeof src["billingEnabled"] === "boolean") {
      access.platformFreeMode = !(src["billingEnabled"] as boolean);
    }

    if (src["featureAccess"] && typeof src["featureAccess"] === "object") {
      const modes: Record<string, FeatureAccessMode> = {};
      for (const [k, v] of Object.entries(src["featureAccess"] as Record<string, unknown>)) {
        if (FEATURE_ACCESS_MODES.includes(v as FeatureAccessMode)) {
          modes[k] = v as FeatureAccessMode;
        }
      }
      if (Object.keys(modes).length > 0) access.featureAccess = modes;
    }

    const grants = src["freeModeEntitlements"];
    if (Array.isArray(grants)) {
      // An explicit empty list is meaningful ("free mode grants nothing"), so
      // it is kept; only junk entries are dropped.
      access.freeModeEntitlements = grants.filter((g): g is EntitlementKey =>
        ALL_ENTITLEMENTS.includes(g as EntitlementKey),
      );
    }

    const tier = src["freeModeAiTier"];
    if (MONETIZATION_AI_TIERS.includes(tier as MonetizationAiTier)) {
      access.freeModeAiTier = tier as MonetizationAiTier;
    }

    if (typeof src["freeModeNotice"] === "string") {
      access.freeModeNotice = (src["freeModeNotice"] as string).slice(0, 300);
    }

    // An explicit null clears the date; a string is kept only when it is a real
    // date. Junk is dropped rather than rendered as "Invalid Date" to members.
    const endsAt = src["freeModeEndsAt"];
    if (endsAt === null) {
      access.freeModeEndsAt = null;
    } else if (typeof endsAt === "string" && Number.isFinite(Date.parse(endsAt))) {
      access.freeModeEndsAt = endsAt;
    }

    // Only emit the key when something actually parsed, so a malformed blob
    // still round-trips to `{}` like every other override group above.
    if (Object.keys(access).length > 0) out.access = access;
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
    access: { ...base.access, ...(overrides.access ?? {}) },
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

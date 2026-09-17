import { describe, expect, it } from "vitest";
import { canCheckoutPrice, resolveFeatureAccess } from "./access";
import {
  DEFAULT_MONETIZATION_CONFIG,
  type MonetizationConfig,
  type EntitlementKey,
} from "./config";
import { entitlementsFor, EMPTY_ENTITLEMENTS } from "./entitlements";

/**
 * The shipped config with monetization fully switched on.
 *
 * Every surface has to be named explicitly, because they all ship OFF — turning
 * free mode off is deliberately not enough to start charging.
 */
function paid(overrides: Partial<MonetizationConfig["access"]> = {}): MonetizationConfig {
  return {
    ...DEFAULT_MONETIZATION_CONFIG,
    access: {
      ...DEFAULT_MONETIZATION_CONFIG.access,
      platformFreeMode: false,
      subscriptionsEnabled: true,
      paymentsEnabled: true,
      premiumFeaturesEnabled: true,
      checkoutEnabled: true,
      merchShopEnabled: true,
      upgradePromptsEnabled: true,
      ...overrides,
    },
  };
}

const ALL: EntitlementKey[] = ["player_plus", "host_pro", "team_pro", "org_pro", "facility_pro"];

describe("free mode (the shipped default)", () => {
  it("ships free — nothing is sold until a superadmin says so", () => {
    expect(DEFAULT_MONETIZATION_CONFIG.access.platformFreeMode).toBe(true);
    expect(resolveFeatureAccess(DEFAULT_MONETIZATION_CONFIG).freeMode).toBe(true);
  });

  it("grants every entitlement to an account that has bought nothing", () => {
    const access = resolveFeatureAccess(DEFAULT_MONETIZATION_CONFIG, EMPTY_ENTITLEMENTS);
    for (const key of ALL) expect(access.has(key)).toBe(true);
  });

  it("suppresses every paid surface", () => {
    const access = resolveFeatureAccess(DEFAULT_MONETIZATION_CONFIG);
    expect(access.showUpgradePrompts).toBe(false);
    expect(access.canCheckout).toBe(false);
    expect(access.merchEnabled).toBe(false);
  });

  it("makes reels unlimited rather than reporting a number to render", () => {
    const access = resolveFeatureAccess(DEFAULT_MONETIZATION_CONFIG);
    expect(access.unlimitedReels).toBe(true);
    expect(Number.isFinite(access.reelAllowance)).toBe(true);
  });

  it("hands every account the configured AI tier", () => {
    expect(resolveFeatureAccess(DEFAULT_MONETIZATION_CONFIG).aiTierOverride).toBe("gym");
  });

  it("refuses checkout for both subscriptions and merch", () => {
    expect(canCheckoutPrice(DEFAULT_MONETIZATION_CONFIG, "ai_highlight_reel_monthly", false)).toBe(
      false,
    );
    expect(canCheckoutPrice(DEFAULT_MONETIZATION_CONFIG, "merch_tee_onetime", true)).toBe(false);
  });

  it("can be narrowed to grant only some entitlements", () => {
    const config: MonetizationConfig = {
      ...DEFAULT_MONETIZATION_CONFIG,
      access: { ...DEFAULT_MONETIZATION_CONFIG.access, freeModeEntitlements: ["player_plus"] },
    };
    const access = resolveFeatureAccess(config);
    expect(access.has("player_plus")).toBe(true);
    expect(access.has("host_pro")).toBe(false);
  });
});

describe("turning billing back on restores the paid product", () => {
  it("stops granting entitlements nobody paid for", () => {
    const access = resolveFeatureAccess(paid(), EMPTY_ENTITLEMENTS);
    expect(access.freeMode).toBe(false);
    for (const key of ALL) expect(access.has(key)).toBe(false);
  });

  it("grants exactly what a real subscription carries, and nothing else", () => {
    const state = entitlementsFor([
      { status: "active", price_id: "ai_highlight_reel_monthly", tier: null },
    ]);
    const access = resolveFeatureAccess(paid(), state);
    expect(access.has("player_plus")).toBe(true);
    expect(access.has("host_pro")).toBe(false);
  });

  it("brings back upgrade prompts, checkout and the reel allowance", () => {
    const access = resolveFeatureAccess(paid());
    expect(access.showUpgradePrompts).toBe(true);
    expect(access.canCheckout).toBe(true);
    expect(access.merchEnabled).toBe(true);
    expect(access.unlimitedReels).toBe(false);
    expect(access.reelAllowance).toBe(DEFAULT_MONETIZATION_CONFIG.freeReelAllowance);
  });

  it("stops overriding the AI tier so real entitlements decide it", () => {
    expect(resolveFeatureAccess(paid()).aiTierOverride).toBeNull();
  });

  it("stays free until the surfaces are switched on, not just free mode off", () => {
    // The spec's staged rollout: free mode off alone charges nobody.
    const staged: MonetizationConfig = {
      ...DEFAULT_MONETIZATION_CONFIG,
      access: { ...DEFAULT_MONETIZATION_CONFIG.access, platformFreeMode: false },
    };
    const access = resolveFeatureAccess(staged, EMPTY_ENTITLEMENTS);
    expect(access.freeMode).toBe(false);
    expect(access.canCheckout).toBe(false);
    expect(access.merchEnabled).toBe(false);
    expect(access.showUpgradePrompts).toBe(false);
    expect(canCheckoutPrice(staged, "ai_highlight_reel_monthly", false)).toBe(false);
  });

  it("honours the per-surface switches independently", () => {
    const noMerch = resolveFeatureAccess(paid({ merchShopEnabled: false }));
    expect(noMerch.merchEnabled).toBe(false);
    expect(noMerch.canCheckout).toBe(true); // subscriptions still sellable

    expect(canCheckoutPrice(paid({ merchShopEnabled: false }), "merch_tee_onetime", true)).toBe(
      false,
    );
    expect(
      canCheckoutPrice(paid({ subscriptionsEnabled: false }), "ai_highlight_reel_monthly", false),
    ).toBe(false);

    expect(resolveFeatureAccess(paid({ upgradePromptsEnabled: false })).showUpgradePrompts).toBe(
      false,
    );
  });
});

describe("degenerate config", () => {
  it("falls open to free when the access block is missing entirely", () => {
    const config = { ...DEFAULT_MONETIZATION_CONFIG } as MonetizationConfig;
    // Simulates a row written before `access` existed.
    delete (config as { access?: unknown }).access;
    expect(resolveFeatureAccess(config).freeMode).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import {
  DEFAULT_MONETIZATION_CONFIG,
  formatPriceCents,
  liveProducts,
  parseMonetizationOverrides,
  priceLabelFor,
  productForEntitlement,
  productForPriceId,
  resolveMonetizationConfig,
} from "./config";

describe("catalog integrity", () => {
  it("keeps every price identifier unique across current and legacy ids", () => {
    const ids = DEFAULT_MONETIZATION_CONFIG.products.flatMap((p) => [p.priceId, ...p.legacyPriceIds]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the plans that are already on sale buyable", () => {
    for (const id of [
      "ai_highlight_reel_monthly",
      "host_subscription_monthly",
      "team_plan_monthly",
      "org_plan_monthly",
    ]) {
      expect(productForPriceId(id)?.status).toBe("live");
    }
  });

  it("reserves the facility tier without selling it", () => {
    expect(productForEntitlement("facility_pro")?.status).toBe("reserved");
    expect(liveProducts(DEFAULT_MONETIZATION_CONFIG).some((p) => p.entitlement === "facility_pro")).toBe(
      false,
    );
  });

  it("launches Host Pro at $19.99 and ballaCity+ at $9.99", () => {
    expect(priceLabelFor(productForEntitlement("host_pro")!)).toBe("$19.99/mo");
    expect(priceLabelFor(productForEntitlement("player_plus")!)).toBe("$9.99/mo");
  });

  it("formats whole-dollar prices without cents", () => {
    expect(formatPriceCents(4900)).toBe("$49");
    expect(formatPriceCents(1999)).toBe("$19.99");
  });
});

describe("admin overrides", () => {
  it("changes a price without a deploy", () => {
    const config = resolveMonetizationConfig(
      parseMonetizationOverrides({ prices: { host_subscription_monthly: 2499 } }),
    );
    expect(productForEntitlement("host_pro", config)!.priceCents).toBe(2499);
  });

  it("ignores junk instead of breaking pricing", () => {
    expect(parseMonetizationOverrides(null)).toEqual({});
    expect(parseMonetizationOverrides("nope")).toEqual({});
    expect(parseMonetizationOverrides({ prices: { host_pro_monthly: "free" } })).toEqual({});
    expect(parseMonetizationOverrides({ fees: { platformFeeBps: -5 } })).toEqual({});
  });

  it("falls back to built-in defaults with no overrides saved", () => {
    expect(resolveMonetizationConfig(parseMonetizationOverrides({}))).toEqual(
      DEFAULT_MONETIZATION_CONFIG,
    );
  });
});

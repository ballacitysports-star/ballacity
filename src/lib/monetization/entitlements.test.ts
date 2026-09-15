import { describe, it, expect } from "vitest";
import {
  ALWAYS_FREE_CAPABILITIES,
  entitlementsFor,
  hasEntitlement,
  isAccessGrantingSubscription,
  requiresEntitlement,
  tierForPriceId,
} from "./entitlements";
import { DEFAULT_MONETIZATION_CONFIG, FREE_TIER_FEATURES } from "./config";

const NOW = new Date("2026-09-14T00:00:00Z").getTime();
const FUTURE = "2026-10-14T00:00:00Z";
const PAST = "2026-08-14T00:00:00Z";

describe("subscription access window", () => {
  it("grants access while active, trialing or past due", () => {
    for (const status of ["active", "trialing", "past_due"]) {
      expect(
        isAccessGrantingSubscription(
          { status, price_id: "host_subscription_monthly", current_period_end: FUTURE },
          NOW,
        ),
      ).toBe(true);
    }
  });

  it("keeps access after cancellation until the paid period ends", () => {
    expect(
      isAccessGrantingSubscription(
        { status: "canceled", price_id: "host_subscription_monthly", current_period_end: FUTURE },
        NOW,
      ),
    ).toBe(true);
    expect(
      isAccessGrantingSubscription(
        { status: "canceled", price_id: "host_subscription_monthly", current_period_end: PAST },
        NOW,
      ),
    ).toBe(false);
  });

  it("denies access on an expired or unknown status", () => {
    expect(
      isAccessGrantingSubscription(
        { status: "active", price_id: "host_subscription_monthly", current_period_end: PAST },
        NOW,
      ),
    ).toBe(false);
    expect(
      isAccessGrantingSubscription(
        { status: "incomplete_expired", price_id: "host_subscription_monthly" },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("legacy price identifiers", () => {
  it("maps every plan we have ever sold to a tier", () => {
    expect(tierForPriceId("host_subscription_monthly")).toBe("host_pro");
    expect(tierForPriceId("host_pro_monthly")).toBe("host_pro");
    expect(tierForPriceId("ai_highlight_reel_monthly")).toBe("player_plus");
    expect(tierForPriceId("ballacity_plus_monthly")).toBe("player_plus");
    expect(tierForPriceId("team_plan_monthly")).toBe("team_pro");
    expect(tierForPriceId("org_plan_monthly")).toBe("org_pro");
  });

  it("does not invent a tier for an unknown price", () => {
    expect(tierForPriceId("merch_tee_onetime")).toBeNull();
  });
});

describe("entitlement derivation", () => {
  it("gives an existing host subscriber Host Pro", () => {
    const state = entitlementsFor(
      [{ status: "active", price_id: "host_subscription_monthly", current_period_end: FUTURE }],
      NOW,
    );
    expect(hasEntitlement(state, "host_pro")).toBe(true);
    expect(hasEntitlement(state, "player_plus")).toBe(false);
  });

  it("prefers the tier recorded by the billing webhook", () => {
    const state = entitlementsFor(
      [
        {
          status: "active",
          price_id: "some_future_price",
          tier: "player_plus",
          current_period_end: FUTURE,
        },
      ],
      NOW,
    );
    expect(hasEntitlement(state, "player_plus")).toBe(true);
  });

  it("combines multiple plans and flags past due", () => {
    const state = entitlementsFor(
      [
        { status: "past_due", price_id: "host_subscription_monthly", current_period_end: FUTURE },
        { status: "active", price_id: "ai_highlight_reel_monthly", current_period_end: FUTURE },
      ],
      NOW,
    );
    expect(hasEntitlement(state, "host_pro")).toBe(true);
    expect(hasEntitlement(state, "player_plus")).toBe(true);
    expect(state.pastDue).toBe(true);
  });

  it("gives a free account nothing", () => {
    const state = entitlementsFor([], NOW);
    expect(state.entitlements.size).toBe(0);
  });
});

describe("the free tier stays free", () => {
  it("never routes a core capability through an entitlement check", () => {
    for (const capability of ALWAYS_FREE_CAPABILITIES) {
      expect(requiresEntitlement(capability)).toBe(false);
    }
  });

  it("advertises free capabilities on the pricing page", () => {
    expect(FREE_TIER_FEATURES.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps free AI reels for everyone", () => {
    expect(DEFAULT_MONETIZATION_CONFIG.freeReelAllowance).toBeGreaterThan(0);
  });
});

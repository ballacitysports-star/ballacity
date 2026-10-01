/**
 * The decision matrix for `canAccessFeature`.
 *
 * The assertions that matter most are the ones proving Free Mode cannot widen
 * a safety decision: a minor blocked by age, a guardian control, a consent
 * requirement or a suspension must stay blocked no matter what the monetization
 * settings say.
 */

import { describe, expect, it } from "vitest";
import { canAccessFeature, featureMode } from "./can-access";
import { DEFAULT_MONETIZATION_CONFIG, type MonetizationConfig } from "./config";
import { entitlementsFor, EMPTY_ENTITLEMENTS, ALWAYS_FREE_CAPABILITIES } from "./entitlements";
import { FEATURE_REGISTRY, featureFor, isConfigurable } from "./features";
import { can, parseChildControls, FEATURE_KEYS } from "@/lib/child-policy";

/** Free mode on (the shipped default), with per-feature pricing applied. */
function free(featureAccess: Record<string, "free" | "premium" | "disabled"> = {}) {
  return cfg({ platformFreeMode: true, featureAccess });
}

/** Monetization fully on. */
function paid(featureAccess: Record<string, "free" | "premium" | "disabled"> = {}) {
  return cfg({
    platformFreeMode: false,
    subscriptionsEnabled: true,
    paymentsEnabled: true,
    premiumFeaturesEnabled: true,
    checkoutEnabled: true,
    featureAccess,
  });
}

function cfg(access: Partial<MonetizationConfig["access"]>): MonetizationConfig {
  return {
    ...DEFAULT_MONETIZATION_CONFIG,
    access: { ...DEFAULT_MONETIZATION_CONFIG.access, ...access },
  };
}

const PLUS = entitlementsFor([
  { status: "active", price_id: "ai_highlight_reel_monthly", tier: null },
]);

describe("adult member, nothing bought", () => {
  it("reaches every feature while free mode is on", () => {
    for (const f of FEATURE_REGISTRY) {
      const d = canAccessFeature({
        feature: f.key,
        config: free(),
        entitlements: EMPTY_ENTITLEMENTS,
        platformStatus: "active",
      });
      expect(d.allowed, `${f.key} should be allowed in free mode`).toBe(true);
    }
  });

  it("never hits a payment requirement, even for features priced premium", () => {
    const config = free({ ai_reel_coach: "premium", ai_reel_pipeline: "premium" });
    for (const key of ["ai_reel_coach", "ai_reel_pipeline"]) {
      const d = canAccessFeature({ feature: key, config, entitlements: EMPTY_ENTITLEMENTS });
      expect(d.allowed).toBe(true);
      expect(d.level).not.toBe("payment_required");
    }
  });
});

describe("free mode never bypasses safety", () => {
  // Real decisions from child-policy, not hand-written stand-ins.
  const childBlocked = can("game_hosting", { cohort: "child_under_13" });
  const guardianOff = can("ai_analysis", {
    cohort: "teen_13_15",
    controls: parseChildControls({ ai_analysis: false }),
  });

  it("is a genuine denial to begin with", () => {
    expect(childBlocked.allowed).toBe(false);
    expect(guardianOff.allowed).toBe(false);
  });

  it("keeps an age-blocked feature blocked with free mode ON", () => {
    const d = canAccessFeature({
      feature: "host_game",
      config: free(),
      entitlements: EMPTY_ENTITLEMENTS,
      safety: childBlocked,
      platformStatus: "active",
    });
    expect(d.allowed).toBe(false);
    // The safety level and reason survive: a member must not be told a payment
    // is needed when the real reason is their age.
    expect(d.level).toBe(childBlocked.level);
    expect(d.level).not.toBe("payment_required");
    expect(d.reason).toBe(childBlocked.reason);
  });

  it("keeps a guardian-restricted feature blocked with free mode ON", () => {
    const d = canAccessFeature({
      feature: "ai_reel_coach",
      config: free(),
      entitlements: EMPTY_ENTITLEMENTS,
      safety: guardianOff,
      platformStatus: "active",
    });
    expect(d.allowed).toBe(false);
    expect(d.level).not.toBe("payment_required");
  });

  it("keeps a suspended account blocked with free mode ON", () => {
    const d = canAccessFeature({
      feature: "ai_reel_pipeline",
      config: free(),
      entitlements: EMPTY_ENTITLEMENTS,
      platformStatus: "suspended",
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/suspended/i);
  });

  it("checks account status and safety before pricing, not after", () => {
    // A disabled feature AND a suspension: the suspension must be the answer,
    // proving ordering rather than coincidence.
    const d = canAccessFeature({
      feature: "ai_reel_coach",
      config: free({ ai_reel_coach: "disabled" }),
      platformStatus: "suspended",
    });
    expect(d.level).toBe("blocked");
  });
});

describe("disabled beats free mode", () => {
  it("stays unavailable even though everything else is free", () => {
    const d = canAccessFeature({
      feature: "ai_background_remove",
      config: free({ ai_background_remove: "disabled" }),
      platformStatus: "active",
    });
    expect(d.allowed).toBe(false);
    expect(d.level).toBe("feature_disabled");
  });

  it("cannot be unlocked by fabricating entitlements", () => {
    const d = canAccessFeature({
      feature: "ai_background_remove",
      config: free({ ai_background_remove: "disabled" }),
      entitlements: PLUS,
    });
    expect(d.allowed).toBe(false);
  });
});

describe("staged monetization", () => {
  it("charges nobody when free mode is off but premium enforcement is too", () => {
    const config = cfg({ platformFreeMode: false, premiumFeaturesEnabled: false });
    const d = canAccessFeature({
      feature: "ai_reel_coach",
      config: {
        ...config,
        access: { ...config.access, featureAccess: { ai_reel_coach: "premium" } },
      },
      entitlements: EMPTY_ENTITLEMENTS,
    });
    expect(d.allowed).toBe(true);
  });

  it("enforces exactly the features marked premium once enforcement is on", () => {
    const config = paid({ ai_reel_coach: "premium" });

    const gated = canAccessFeature({
      feature: "ai_reel_coach",
      config,
      entitlements: EMPTY_ENTITLEMENTS,
    });
    expect(gated.allowed).toBe(false);
    expect(gated.level).toBe("payment_required");

    // An unpriced feature is untouched.
    const open = canAccessFeature({
      feature: "ai_reel_style",
      config,
      entitlements: EMPTY_ENTITLEMENTS,
    });
    expect(open.allowed).toBe(true);
  });

  it("lets the entitlement holder through", () => {
    const d = canAccessFeature({
      feature: "ai_reel_coach",
      config: paid({ ai_reel_coach: "premium" }),
      entitlements: PLUS,
    });
    expect(d.allowed).toBe(true);
  });
});

describe("registry integrity", () => {
  it("never offers a control over safety scanning", () => {
    // Mirrors PLATFORM_FEATURES in @/lib/ai/gate.server. Pricing moderation
    // would mean charging members not to have content held for review.
    for (const key of ["text_moderation", "image_moderation"]) {
      const f = featureFor(key)!;
      expect(f.tier).toBe("safety");
      expect(isConfigurable(f)).toBe(false);
      // Even a hand-edited settings row cannot switch it off.
      expect(featureMode(f, free({ [key]: "disabled" }))).toBe("free");
      expect(featureMode(f, paid({ [key]: "premium" }))).toBe("free");
    }
  });

  it("never prices a capability the free tier guarantees", () => {
    for (const f of FEATURE_REGISTRY.filter((x) => x.tier === "alwaysFree")) {
      expect(featureMode(f, paid({ [f.key]: "premium" }))).toBe("free");
      expect(
        canAccessFeature({ feature: f.key, config: paid({ [f.key]: "premium" }) }).allowed,
      ).toBe(true);
    }
  });

  it("covers every always-free capability the guards declare", () => {
    const registryKeys = new Set(FEATURE_REGISTRY.map((f) => f.key));
    const declared = ALWAYS_FREE_CAPABILITIES.filter((c) => registryKeys.has(c));
    // Not every declared capability needs a row, but the ones that have one
    // must be marked alwaysFree rather than quietly priceable.
    for (const key of declared) {
      expect(featureFor(key)!.tier).toBe("alwaysFree");
    }
  });

  it("maps every entry onto a real child-policy feature, or explicitly onto none", () => {
    for (const f of FEATURE_REGISTRY) {
      if (f.safetyKey === null) continue;
      expect(FEATURE_KEYS, `${f.key} maps to an unknown safety key`).toContain(f.safetyKey);
    }
  });

  it("has unique keys", () => {
    const keys = FEATURE_REGISTRY.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("degenerate input", () => {
  it("treats an unknown feature as free rather than as an excuse to charge", () => {
    expect(canAccessFeature({ feature: "not_a_feature", config: paid() }).allowed).toBe(true);
  });

  it("falls back to the shipped (free) config when none is supplied", () => {
    expect(canAccessFeature({ feature: "ai_reel_coach" }).allowed).toBe(true);
  });
});

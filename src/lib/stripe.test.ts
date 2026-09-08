import { describe, expect, it } from "vitest";
import {
  DEFAULT_BILLING_ENVIRONMENT,
  billingEnvironmentFor,
  paymentsConfiguredFor,
} from "./stripe";

/**
 * The free tier must not depend on Stripe.
 *
 * highlight_reels rows are partitioned by `environment`, and every read and
 * write of that table used to resolve it through getStripeEnvironment(), which
 * throws when the build has no publishable key. On the deployed build (no
 * VITE_PAYMENTS_CLIENT_TOKEN) that turned "upload your first free reel" into a
 * Stripe go-live error, and left "Your reels" permanently empty — a paywall on
 * the three reels that are supposed to be free.
 *
 * billingEnvironmentFor() is the non-throwing resolver those paths use now.
 */

describe("billingEnvironmentFor", () => {
  it("resolves the live partition only for a live key", () => {
    expect(billingEnvironmentFor("pk_live_abc123")).toBe("live");
  });

  it("resolves the sandbox partition for a test key", () => {
    expect(billingEnvironmentFor("pk_test_abc123")).toBe("sandbox");
  });

  it("falls back to the database default when no key is configured", () => {
    // public.highlight_reels.environment is `NOT NULL DEFAULT 'sandbox'`, so an
    // unconfigured build reads and writes the partition Postgres would pick.
    expect(DEFAULT_BILLING_ENVIRONMENT).toBe("sandbox");
    expect(billingEnvironmentFor(undefined)).toBe("sandbox");
    expect(billingEnvironmentFor("")).toBe("sandbox");
  });

  it("never throws, whatever the token looks like", () => {
    for (const token of [undefined, "", "sk_live_leaked", "garbage", "pk_"]) {
      expect(() => billingEnvironmentFor(token)).not.toThrow();
    }
  });

  it("does not treat a malformed key as live", () => {
    // Guessing "live" from an unusable key would strand a member's existing
    // sandbox reels behind a partition they can't read.
    expect(billingEnvironmentFor("live")).toBe("sandbox");
    expect(billingEnvironmentFor("sk_live_abc")).toBe("sandbox");
  });
});

describe("paymentsConfiguredFor", () => {
  it("is true only for a Stripe publishable key", () => {
    expect(paymentsConfiguredFor("pk_test_abc")).toBe(true);
    expect(paymentsConfiguredFor("pk_live_abc")).toBe(true);
  });

  it("is false when nothing usable is configured", () => {
    for (const token of [undefined, "", "pk_", "sk_live_abc", "garbage"]) {
      expect(paymentsConfiguredFor(token)).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";
import { ALWAYS_FREE_CAPABILITIES, requiresEntitlement } from "./entitlements";
import { DEFAULT_MONETIZATION_CONFIG, liveProducts } from "./config";
import { quoteFees } from "./fees";
import { displayStatusFor, displayStatusLabel } from "@/lib/payment-states";

describe("the platform ships free", () => {
  it("has billing switched off in the shipped config", () => {
    expect(DEFAULT_MONETIZATION_CONFIG.access.billingEnabled).toBe(false);
  });

  it("keeps the paid catalog intact so billing can be switched back on", () => {
    // Free mode must never be implemented by deleting products.
    expect(liveProducts(DEFAULT_MONETIZATION_CONFIG).length).toBeGreaterThan(0);
    expect(DEFAULT_MONETIZATION_CONFIG.access.subscriptionsEnabled).toBe(true);
    expect(DEFAULT_MONETIZATION_CONFIG.access.merchShopEnabled).toBe(true);
  });
});

describe("free tier stays free", () => {
  it("never puts a core capability behind an entitlement", () => {
    for (const capability of ALWAYS_FREE_CAPABILITIES) {
      expect(requiresEntitlement(capability)).toBe(false);
    }
  });

  it("keeps discovery, joining, hosting and messaging in the free list", () => {
    for (const core of [
      "discover_games",
      "join_game",
      "host_game",
      "messaging",
      "teams",
    ] as const) {
      expect(ALWAYS_FREE_CAPABILITIES).toContain(core);
    }
  });
});

describe("direct host payments carry no platform fee", () => {
  it("charges nothing on top of the host's fee", () => {
    const quote = quoteFees({ amountCents: 2500, mode: "direct_host" });
    expect(quote.platformFeeCents).toBe(0);
    expect(quote.processingFeeCents).toBe(0);
    expect(quote.totalCents).toBe(2500);
    expect(quote.hostReceivesCents).toBe(2500);
  });
});

describe("processed payments are not live", () => {
  it("stays switched off in the shipped config", () => {
    expect(DEFAULT_MONETIZATION_CONFIG.ballacityProcessedPaymentsEnabled).toBe(false);
  });
});

describe("plan catalog", () => {
  it("offers ballaCity+ and Host Pro as live products", () => {
    const entitlements = liveProducts(DEFAULT_MONETIZATION_CONFIG).map((p) => p.entitlement);
    expect(entitlements).toContain("player_plus");
    expect(entitlements).toContain("host_pro");
  });
});

describe("payment display statuses", () => {
  it("maps the internal lifecycle onto plain labels", () => {
    expect(displayStatusFor("payment_required")).toBe("unpaid");
    expect(displayStatusFor("instructions_shown")).toBe("unpaid");
    expect(displayStatusFor("payment_sent")).toBe("marked_paid");
    expect(displayStatusFor("host_confirmation_pending")).toBe("marked_paid");
    expect(displayStatusFor("confirmed")).toBe("confirmed");
    expect(displayStatusFor("cancelled")).toBe("cancelled");
    expect(displayStatusLabel("confirmed", { refunded: true })).toBe("Refunded");
  });
});

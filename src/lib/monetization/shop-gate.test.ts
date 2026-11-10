import { readFileSync } from "node:fs";
import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MONETIZATION_CONFIG, type MonetizationConfig } from "./config";
import { merchShopOpen, requireMerchShopOpen } from "./shop-gate";

/**
 * P0-11: while the merch shop is off, /shop answers with the ordinary 404 page,
 * as the developer routes do in production, instead of an empty page that is
 * indexed and then redirected in the browser.
 */

const withAccess = (access: Partial<MonetizationConfig["access"]>): MonetizationConfig => ({
  ...DEFAULT_MONETIZATION_CONFIG,
  access: { ...DEFAULT_MONETIZATION_CONFIG.access, ...access },
});

const thrownBy = (fn: () => void) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
};

describe("merch shop gate", () => {
  it("is closed in the shipped config (BallaCity is free) and answers 404", () => {
    expect(merchShopOpen(DEFAULT_MONETIZATION_CONFIG)).toBe(false);
    expect(isNotFound(thrownBy(() => requireMerchShopOpen(false)))).toBe(true);
  });

  it("stays closed in free mode even when the shop switch is on", () => {
    expect(merchShopOpen(withAccess({ platformFreeMode: true, merchShopEnabled: true }))).toBe(
      false,
    );
  });

  it("opens only when free mode is off and the shop switch is on", () => {
    expect(merchShopOpen(withAccess({ platformFreeMode: false, merchShopEnabled: true }))).toBe(
      true,
    );
    expect(merchShopOpen(withAccess({ platformFreeMode: false, merchShopEnabled: false }))).toBe(
      false,
    );
    expect(thrownBy(() => requireMerchShopOpen(true))).toBeNull();
  });
});

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (fn: () => unknown) => fn,
  }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from() {
      throw new Error("settings unreadable");
    },
  },
}));

describe("getMerchShopOpen", () => {
  it("reports the shop closed when the setting cannot be read (fail closed)", async () => {
    const { getMerchShopOpen } = await import("./shop.functions");
    const read = getMerchShopOpen as unknown as () => Promise<{ open: boolean }>;
    expect(await read()).toEqual({ open: false });
  });
});

describe("/shop route", () => {
  it("checks the gate in beforeLoad and no longer redirects in the browser", () => {
    const route = readFileSync("src/routes/shop.tsx", "utf8");
    expect(route).toMatch(
      /beforeLoad:\s*async \(\) => \{[\s\S]*?getMerchShopOpen\(\)[\s\S]*?requireMerchShopOpen\(open\)/,
    );
    expect(route).not.toMatch(/navigate\(\{ to: "\/profile" \}\)/);
  });
});

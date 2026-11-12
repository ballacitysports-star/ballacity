// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Plan P3-4: Stripe loads only when checkout opens.
 *
 * @stripe/stripe-js's main entry injects https://js.stripe.com as soon as it is imported. src/lib/stripe.ts imported
 * it, and Reels, /plans and the subscription hooks import that module, so every viewer (minors included) loaded
 * Stripe's script while payments are free.
 */

const stripeScript = () => document.querySelector('script[src^="https://js.stripe.com"]');
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.head.innerHTML = "";
  vi.unstubAllEnvs();
  vi.doUnmock("@stripe/stripe-js/pure");
  vi.resetModules();
});

describe("pages that can offer checkout", () => {
  it("load no Stripe script just by importing the payment helpers and the checkout hook", async () => {
    vi.stubEnv("VITE_PAYMENTS_CLIENT_TOKEN", "pk_test_lazy");
    vi.resetModules();
    await import("./stripe");
    await import("@/hooks/useStripeCheckout");
    await tick();
    await tick();
    expect(stripeScript()).toBeNull();
  });
});

describe("opening checkout", () => {
  it("loads the checkout component then, showing a loading line meanwhile", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.doMock("@/components/StripeEmbeddedCheckout", async () => {
      await gate;
      return {
        StripeEmbeddedCheckout: ({ priceId }: { priceId: string }) =>
          createElement("p", null, `checkout for ${priceId}`),
      };
    });
    vi.resetModules();
    const { useStripeCheckout } = await import("@/hooks/useStripeCheckout");
    const { result } = renderHook(() => useStripeCheckout());
    expect(result.current.checkoutElement).toBeNull();
    act(() => result.current.openCheckout({ priceId: "price_pro" }));
    const view = render(createElement("div", null, result.current.checkoutElement));
    expect(view.getByRole("status").textContent).toMatch(/Loading checkout/);
    release();
    await waitFor(() => expect(view.getByText("checkout for price_pro")).toBeTruthy());
    view.unmount();
    vi.doUnmock("@/components/StripeEmbeddedCheckout");
  });
});

describe("getStripe", () => {
  it("loads Stripe.js through the pure entry, once, with this build's key", async () => {
    vi.stubEnv("VITE_PAYMENTS_CLIENT_TOKEN", "pk_test_lazy");
    const loadStripe = vi.fn(async () => ({ id: "stripe" }));
    vi.doMock("@stripe/stripe-js/pure", () => ({ loadStripe }));
    vi.resetModules();
    const { getStripe } = await import("./stripe-loader");
    await expect(getStripe()).resolves.toEqual({ id: "stripe" });
    await getStripe();
    expect(loadStripe).toHaveBeenCalledTimes(1);
    expect(loadStripe).toHaveBeenCalledWith("pk_test_lazy");
  });

  it("tries again after a failed load instead of keeping the failure", async () => {
    vi.stubEnv("VITE_PAYMENTS_CLIENT_TOKEN", "pk_test_lazy");
    const loadStripe = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ id: "stripe" });
    vi.doMock("@stripe/stripe-js/pure", () => ({ loadStripe }));
    vi.resetModules();
    const { getStripe } = await import("./stripe-loader");
    await expect(getStripe()).rejects.toThrow("offline");
    await expect(getStripe()).resolves.toEqual({ id: "stripe" });
  });

  it("refuses before loading anything when the build has no publishable key", async () => {
    vi.stubEnv("VITE_PAYMENTS_CLIENT_TOKEN", "");
    const loadStripe = vi.fn();
    vi.doMock("@stripe/stripe-js/pure", () => ({ loadStripe }));
    vi.resetModules();
    const { getStripe } = await import("./stripe-loader");
    expect(() => getStripe()).toThrow(/not configured/);
    expect(loadStripe).not.toHaveBeenCalled();
  });
});

describe("where Stripe may be imported", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
    });
  }

  it("only the loader and the checkout component import @stripe/*, and nothing imports the main entry at runtime", () => {
    const importers: string[] = [];
    for (const file of sources("src")) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(
        /^\s*import\s+(type\s+)?[^;]*?from\s+["'](@stripe\/[^"']+)["']/gm,
      )) {
        importers.push(`${file} ${m[1] ? "type " : ""}${m[2]}`);
      }
      for (const m of src.matchAll(/import\(\s*["'](@stripe\/[^"']+)["']\s*\)/g)) {
        importers.push(`${file} dynamic ${m[1]}`);
      }
    }
    expect(importers.sort()).toEqual([
      "src/components/StripeEmbeddedCheckout.tsx @stripe/react-stripe-js",
      "src/lib/stripe-loader.ts dynamic @stripe/stripe-js/pure",
      "src/lib/stripe-loader.ts type @stripe/stripe-js",
    ]);
  });

  it("the checkout hook loads the checkout component lazily", () => {
    const src = readFileSync("src/hooks/useStripeCheckout.tsx", "utf8");
    expect(src).not.toMatch(/^import[^;]*from\s+["']@\/components\/StripeEmbeddedCheckout["']/m);
    expect(src).toMatch(
      /lazy\(\(\)\s*=>\s*import\(["']@\/components\/StripeEmbeddedCheckout["']\)/,
    );
  });
});

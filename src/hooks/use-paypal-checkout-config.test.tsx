// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

/**
 * Contract: the PayPal config is optional and loads beside the pay screen. A
 * slow, failed or empty answer leaves it null; nothing waits on it.
 */

vi.mock("@/lib/paypal.functions", () => ({ getPayPalCheckoutConfig: vi.fn() }));

const { usePayPalCheckoutConfig } = await import("@/hooks/use-paypal-checkout-config");

const CFG = { clientId: "client-1", merchantId: "merchant-1" };

describe("usePayPalCheckoutConfig", () => {
  it("is null while the answer is pending, then the config", async () => {
    let resolve!: (v: typeof CFG) => void;
    const fetchConfig = vi.fn(() => new Promise<typeof CFG>((r) => (resolve = r)));
    const { result } = renderHook(() => usePayPalCheckoutConfig("g2", fetchConfig));
    expect(result.current).toBeNull();
    expect(fetchConfig).toHaveBeenCalledWith("g2");
    await act(async () => resolve(CFG));
    expect(result.current).toEqual(CFG);
  });

  it("stays null when PayPal is not set up or the lookup fails", async () => {
    const empty = renderHook(() =>
      usePayPalCheckoutConfig("g2", async () => ({ clientId: null, merchantId: null })),
    );
    const failing = renderHook(() =>
      usePayPalCheckoutConfig("g2", async () => {
        throw new Error("server down");
      }),
    );
    await act(async () => {});
    expect(empty.result.current).toBeNull();
    expect(failing.result.current).toBeNull();
  });

  it("asks nothing until there is a game", () => {
    const fetchConfig = vi.fn(async () => CFG);
    const { result } = renderHook(() => usePayPalCheckoutConfig(undefined, fetchConfig));
    expect(fetchConfig).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("drops a late answer for a game the page has left", async () => {
    const answers: Record<string, (v: typeof CFG) => void> = {};
    const fetchConfig = vi.fn((id: string) => new Promise<typeof CFG>((r) => (answers[id] = r)));
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => usePayPalCheckoutConfig(id, fetchConfig),
      { initialProps: { id: "g1" } },
    );
    rerender({ id: "g2" });
    await act(async () => answers.g1!({ clientId: "old", merchantId: "old" }));
    expect(result.current).toBeNull();
    await act(async () => answers.g2!(CFG));
    expect(result.current).toEqual(CFG);
  });
});

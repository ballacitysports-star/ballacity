// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

/**
 * Contract: the PayPal config is optional and loads beside the pay screen, with its own deadline. Until it settles
 * (answer, failure or deadline) the page must not treat it as "no PayPal"; after that, a slow, failed or empty answer
 * leaves it null. Retry asks again.
 */

vi.mock("@/lib/paypal.functions", () => ({ getPayPalCheckoutConfig: vi.fn() }));

const { payOptionsView, usePayPalCheckoutConfig } =
  await import("@/hooks/use-paypal-checkout-config");

const CFG = { clientId: "client-1", merchantId: "merchant-1" };

afterEach(() => {
  vi.useRealTimers();
});

describe("usePayPalCheckoutConfig", () => {
  it("is unsettled with no config while the answer is pending, then the config", async () => {
    let resolve!: (v: typeof CFG) => void;
    const fetchConfig = vi.fn(() => new Promise<typeof CFG>((r) => (resolve = r)));
    const { result } = renderHook(() => usePayPalCheckoutConfig("g2", fetchConfig));
    expect(result.current).toEqual({ config: null, settled: false });
    expect(fetchConfig).toHaveBeenCalledWith("g2");
    await act(async () => resolve(CFG));
    expect(result.current).toEqual({ config: CFG, settled: true });
  });

  it("settles with no config when PayPal is not set up or the lookup fails", async () => {
    const empty = renderHook(() =>
      usePayPalCheckoutConfig("g2", async () => ({ clientId: null, merchantId: null })),
    );
    const failing = renderHook(() =>
      usePayPalCheckoutConfig("g2", async () => {
        throw new Error("server down");
      }),
    );
    await act(async () => {});
    expect(empty.result.current).toEqual({ config: null, settled: true });
    expect(failing.result.current).toEqual({ config: null, settled: true });
  });

  it("settles at its deadline when the lookup hangs, and still takes a late answer", async () => {
    vi.useFakeTimers();
    let resolve!: (v: typeof CFG) => void;
    const fetchConfig = vi.fn(() => new Promise<typeof CFG>((r) => (resolve = r)));
    const { result } = renderHook(() => usePayPalCheckoutConfig("g2", fetchConfig, 0, 6000));
    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(result.current.settled).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual({ config: null, settled: true });
    await act(async () => resolve(CFG));
    expect(result.current).toEqual({ config: CFG, settled: true });
  });

  it("asks again when the retry key changes", async () => {
    const fetchConfig = vi.fn().mockRejectedValueOnce(new Error("blip")).mockResolvedValueOnce(CFG);
    const { result, rerender } = renderHook(
      ({ attempt }: { attempt: number }) => usePayPalCheckoutConfig("g2", fetchConfig, attempt),
      { initialProps: { attempt: 0 } },
    );
    await act(async () => {});
    expect(result.current).toEqual({ config: null, settled: true });
    rerender({ attempt: 1 });
    expect(result.current.settled).toBe(false);
    await act(async () => {});
    expect(fetchConfig).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ config: CFG, settled: true });
  });

  it("asks nothing until there is a game", () => {
    const fetchConfig = vi.fn(async () => CFG);
    const { result } = renderHook(() => usePayPalCheckoutConfig(undefined, fetchConfig));
    expect(fetchConfig).not.toHaveBeenCalled();
    expect(result.current).toEqual({ config: null, settled: true });
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
    expect(result.current).toEqual({ config: null, settled: false });
    await act(async () => answers.g2!(CFG));
    expect(result.current).toEqual({ config: CFG, settled: true });
  });
});

describe("payOptionsView", () => {
  const pending = { config: null, settled: false };
  const none = { config: null, settled: true };
  const ready = { config: CFG, settled: true };

  it("never says the host has no payment while PayPal is still pending", () => {
    expect(payOptionsView({ hasOtherMethods: false, paypal: pending })).toBe("loading");
    expect(payOptionsView({ hasOtherMethods: false, paypal: none })).toBe("empty");
  });

  it("shows the options as soon as there is anything to offer", () => {
    expect(payOptionsView({ hasOtherMethods: true, paypal: pending })).toBe("options");
    expect(payOptionsView({ hasOtherMethods: false, paypal: ready })).toBe("options");
    expect(payOptionsView({ hasOtherMethods: true, paypal: none })).toBe("options");
  });
});

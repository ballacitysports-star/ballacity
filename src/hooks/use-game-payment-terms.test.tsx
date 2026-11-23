// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getTerms = vi.fn();
vi.mock("@/lib/payments", () => ({ getGamePaymentTerms: (...a: unknown[]) => getTerms(...a) }));

const { useGamePaymentTerms } = await import("@/hooks/use-game-payment-terms");

const TERMS = {
  entryFee: 12.5,
  currency: "USD",
  paymentDeadline: null,
  methods: [{ type: "venmo", name: "Venmo" }],
  requiresApproval: false,
};
const SETTINGS = { id: "s", game_id: "g1", host_id: "h", entry_fee: 10 } as never;

describe("useGamePaymentTerms", () => {
  it("is null until the read answers, then the terms", async () => {
    getTerms.mockReset();
    let resolve!: (v: typeof TERMS) => void;
    getTerms.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() =>
      useGamePaymentTerms("g1", null, { enabled: true, userId: "u1" }),
    );
    expect(result.current).toBeNull();
    await act(async () => resolve(TERMS));
    expect(result.current).toEqual(TERMS);
  });

  it("stays null, with no error to show, when the read fails", async () => {
    getTerms.mockReset();
    getTerms.mockRejectedValueOnce(new Error("function does not exist"));
    const { result } = renderHook(() =>
      useGamePaymentTerms("g1", null, { enabled: true, userId: "u1" }),
    );
    await waitFor(() => expect(getTerms).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });

  it("asks nothing of a viewer who reads the settings row, or while signed out", () => {
    getTerms.mockReset();
    renderHook(() => useGamePaymentTerms("g1", SETTINGS, { enabled: true, userId: "u1" }));
    renderHook(() => useGamePaymentTerms("g1", null, { enabled: false, userId: "u1" }));
    renderHook(() => useGamePaymentTerms(undefined, null, { enabled: true, userId: "u1" }));
    expect(getTerms).not.toHaveBeenCalled();
  });

  it("never answers for another game", async () => {
    getTerms.mockReset();
    getTerms.mockResolvedValue(TERMS);
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useGamePaymentTerms(id, null, { enabled: true, userId: "u1" }),
      { initialProps: { id: "g1" } },
    );
    await waitFor(() => expect(result.current).toEqual(TERMS));
    getTerms.mockReturnValue(new Promise(() => {}));
    rerender({ id: "g2" });
    expect(result.current).toBeNull();
  });

  it("drops what it read once the viewer can read the row", async () => {
    getTerms.mockReset();
    getTerms.mockResolvedValue(TERMS);
    const { result, rerender } = renderHook(
      ({ s }: { s: unknown }) =>
        useGamePaymentTerms("g1", s as never, { enabled: true, userId: "u1" }),
      { initialProps: { s: null as unknown } },
    );
    await waitFor(() => expect(result.current).toEqual(TERMS));
    rerender({ s: SETTINGS });
    expect(result.current).toBeNull();
  });

  it("never shows one account's answer to another account on the same game", async () => {
    getTerms.mockReset();
    getTerms.mockResolvedValueOnce(TERMS);
    const { result, rerender } = renderHook(
      ({ uid, on }: { uid: string; on: boolean }) =>
        useGamePaymentTerms("g1", null, { enabled: on, userId: uid }),
      { initialProps: { uid: "u1", on: true } },
    );
    await waitFor(() => expect(result.current).toEqual(TERMS));
    // A signs out, B signs in on the same page: B's own read has not answered yet.
    rerender({ uid: "u1", on: false });
    expect(result.current).toBeNull();
    getTerms.mockReturnValue(new Promise(() => {}));
    rerender({ uid: "u2", on: true });
    expect(result.current).toBeNull();
    // Without a sign-out in between, a change of account is the same.
    getTerms.mockReset();
    getTerms.mockResolvedValueOnce(TERMS);
    rerender({ uid: "u3", on: true });
    await waitFor(() => expect(result.current).toEqual(TERMS));
    getTerms.mockReturnValue(new Promise(() => {}));
    rerender({ uid: "u4", on: true });
    expect(result.current).toBeNull();
  });

  it("asks nothing without a user id", () => {
    getTerms.mockReset();
    renderHook(() => useGamePaymentTerms("g1", null, { enabled: true, userId: undefined }));
    expect(getTerms).not.toHaveBeenCalled();
  });
});

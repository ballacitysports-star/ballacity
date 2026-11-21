import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

const { gamePaymentTermsFrom, getGamePaymentTerms } = await import("@/lib/payments");

const row = {
  entry_fee: 12.5,
  currency: "USD",
  payment_deadline: "2026-12-01T18:00:00+00:00",
  accepted_methods: ["venmo", "cashapp", "custom"],
  requires_approval: false,
};

describe("gamePaymentTermsFrom (the server's row as the app uses it)", () => {
  it("names the accepted apps by their own names, in the server's order", () => {
    expect(gamePaymentTermsFrom(row)).toEqual({
      entryFee: 12.5,
      currency: "USD",
      paymentDeadline: "2026-12-01T18:00:00+00:00",
      methods: [
        { type: "venmo", name: "Venmo" },
        { type: "cashapp", name: "Cash App" },
        { type: "custom", name: "Custom method" },
      ],
      requiresApproval: false,
    });
  });

  it("reads a numeric string fee (numeric columns can come back as text)", () => {
    expect(gamePaymentTermsFrom({ ...row, entry_fee: "10.00" })?.entryFee).toBe(10);
  });

  it("is null for no row, a fee that is not a positive number, or garbage", () => {
    expect(gamePaymentTermsFrom(null)).toBeNull();
    expect(gamePaymentTermsFrom(undefined)).toBeNull();
    expect(gamePaymentTermsFrom("nope")).toBeNull();
    expect(gamePaymentTermsFrom({ ...row, entry_fee: 0 })).toBeNull();
    expect(gamePaymentTermsFrom({ ...row, entry_fee: null })).toBeNull();
    expect(gamePaymentTermsFrom({ ...row, entry_fee: "free" })).toBeNull();
  });

  it("drops an app type this app does not know and a repeated one, and never guesses", () => {
    expect(
      gamePaymentTermsFrom({ ...row, accepted_methods: ["venmo", "venmo", "bitcoin", 7, null] })
        ?.methods,
    ).toEqual([{ type: "venmo", name: "Venmo" }]);
    expect(gamePaymentTermsFrom({ ...row, accepted_methods: null })?.methods).toEqual([]);
  });

  it("keeps only a deadline that is a date", () => {
    expect(gamePaymentTermsFrom({ ...row, payment_deadline: null })?.paymentDeadline).toBeNull();
    expect(gamePaymentTermsFrom({ ...row, payment_deadline: "soon" })?.paymentDeadline).toBeNull();
  });

  it("treats the approval flag as true only when it is exactly true", () => {
    expect(gamePaymentTermsFrom({ ...row, requires_approval: true })?.requiresApproval).toBe(true);
    expect(gamePaymentTermsFrom({ ...row, requires_approval: "yes" })?.requiresApproval).toBe(
      false,
    );
    expect(gamePaymentTermsFrom({ ...row, requires_approval: null })?.requiresApproval).toBe(false);
  });

  it("carries no field beyond the five the function returns (no handle, label or text)", () => {
    const out = gamePaymentTermsFrom({
      ...row,
      username: "HANDLE",
      label: "LABEL",
      instructions: "TEXT",
    });
    expect(JSON.stringify(out)).not.toMatch(/HANDLE|LABEL|TEXT/);
    expect(Object.keys(out!).sort()).toEqual([
      "currency",
      "entryFee",
      "methods",
      "paymentDeadline",
      "requiresApproval",
    ]);
  });
});

describe("getGamePaymentTerms", () => {
  it("asks get_game_payment_terms for the game and maps the first row", async () => {
    rpc.mockResolvedValueOnce({ data: [row], error: null });
    const got = await getGamePaymentTerms("g1");
    expect(rpc).toHaveBeenCalledWith("get_game_payment_terms", { _game_id: "g1" });
    expect(got?.entryFee).toBe(12.5);
  });

  it("is null when the server tells nothing (a refused viewer, no settings, a free game)", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await getGamePaymentTerms("g1")).toBeNull();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await getGamePaymentTerms("g1")).toBeNull();
  });

  it("throws when the call fails, including a function that is not there yet (callers show what they showed before)", async () => {
    const missing = {
      code: "PGRST202",
      message: "Could not find the function public.get_game_payment_terms",
    };
    rpc.mockResolvedValueOnce({ data: null, error: missing });
    await expect(getGamePaymentTerms("g1")).rejects.toBe(missing);
  });
});

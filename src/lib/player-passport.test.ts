import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware: () => ({ inputValidator: () => ({ handler: () => undefined }) }),
  }),
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const { isPassportMinor } = await import("./player-passport.functions");

describe("isPassportMinor", () => {
  it("only a confirmed adult cohort unlocks attendance", () => {
    expect(isPassportMinor("adult")).toBe(false);
  });

  it.each(["child_under_13", "teen_13_15", "teen_16_17"])("treats %s as a minor", (c) => {
    expect(isPassportMinor(c)).toBe(true);
  });

  it("fails closed on unknown, missing or unexpected cohorts", () => {
    expect(isPassportMinor("unknown")).toBe(true);
    expect(isPassportMinor(null)).toBe(true);
    expect(isPassportMinor(undefined)).toBe(true);
    expect(isPassportMinor("something_new")).toBe(true);
  });

  it("fails closed when the lookup errored, even with an adult value", () => {
    expect(isPassportMinor("adult", true)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { repeatLabel, repeatOf, untilError } from "./game-series-api";

describe("repeatOf", () => {
  it("reads what the server writes", () => {
    expect(repeatOf({ freq: "weekly", until: null })).toEqual({ freq: "weekly", until: null });
    expect(repeatOf({ freq: "biweekly", until: "2026-12-20" })).toEqual({
      freq: "biweekly",
      until: "2026-12-20",
    });
  });

  it("anything else does not repeat", () => {
    for (const v of [null, undefined, "weekly", {}, { freq: "daily" }, { freq: "monthly" }]) {
      expect(repeatOf(v)).toBeNull();
    }
    expect(repeatOf({ freq: "weekly", until: "soon" })).toEqual({ freq: "weekly", until: null });
  });
});

describe("repeatLabel", () => {
  it("says how often and until when", () => {
    expect(repeatLabel({ freq: "weekly", until: null })).toBe("Repeats every week");
    expect(repeatLabel({ freq: "biweekly", until: "2026-12-20" })).toBe(
      "Repeats every 2 weeks until Dec 20",
    );
    expect(repeatLabel(null)).toBeNull();
  });
});

describe("untilError", () => {
  it("a last date must be on or after the first game", () => {
    expect(untilError("2026-11-26", null)).toBeNull();
    expect(untilError("2026-11-26", "2026-11-26")).toBeNull();
    expect(untilError("2026-11-26", "2026-12-31")).toBeNull();
    expect(untilError("2026-11-26", "2026-11-25")).toMatch(/on or after/);
    expect(untilError("2026-11-26", "12/31")).toMatch(/valid/);
  });
});

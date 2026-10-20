import { describe, expect, it } from "vitest";
import { gamePlaceLabel } from "./game-place";

describe("gamePlaceLabel", () => {
  it("keeps a plain venue name", () => {
    expect(gamePlaceLabel({ location: "Tompkins Square Courts" })).toBe("Tompkins Square Courts");
  });

  it("keeps the venue name from a name-plus-address", () => {
    expect(
      gamePlaceLabel({ location: "Coolray Field, 2500 Buford Dr, Lawrenceville, GA 30043, USA" }),
    ).toBe("Coolray Field");
  });

  it("shows City, ST for a bare street address", () => {
    expect(gamePlaceLabel({ location: "2500 Buford Dr, Lawrenceville, GA 30043, USA" })).toBe(
      "Lawrenceville, GA",
    );
    expect(gamePlaceLabel({ location: "100 Main St, Atlanta, GA" })).toBe("Atlanta, GA");
  });

  it("falls back to the neighborhood for an address without a state", () => {
    expect(
      gamePlaceLabel({ location: "12 High St, Shoreditch", neighborhood: "East London" }),
    ).toBe("East London");
    expect(gamePlaceLabel({ location: "12 High St, Shoreditch" })).toBe("Shoreditch");
  });

  it("uses the neighborhood when the venue is missing or TBD", () => {
    expect(gamePlaceLabel({ location: "TBD", neighborhood: "Buford, GA" })).toBe("Buford, GA");
    expect(gamePlaceLabel({ location: "", neighborhood: "" })).toBeNull();
    expect(gamePlaceLabel({})).toBeNull();
  });
});

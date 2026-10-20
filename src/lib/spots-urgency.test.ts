import { describe, it, expect } from "vitest";
import { getSpotsUrgency, spotsOpenLabel } from "./spots-urgency";

describe("getSpotsUrgency", () => {
  it("returns full when no spots remain", () => {
    expect(getSpotsUrgency(0, 10)).toBe("full");
    expect(getSpotsUrgency(-1, 10)).toBe("full");
  });

  it("returns critical for 1-3 remaining regardless of capacity", () => {
    expect(getSpotsUrgency(1, 100)).toBe("critical");
    expect(getSpotsUrgency(3, 100)).toBe("critical");
    expect(getSpotsUrgency(3)).toBe("critical");
  });

  it("returns low when >3 but within 20% of capacity", () => {
    // 20 capacity, 4 left -> 20% -> low
    expect(getSpotsUrgency(4, 20)).toBe("low");
    // 50 capacity, 10 left -> 20% -> low
    expect(getSpotsUrgency(10, 50)).toBe("low");
  });

  it("returns normal when plenty of room", () => {
    expect(getSpotsUrgency(15, 20)).toBe("normal");
    expect(getSpotsUrgency(50, 100)).toBe("normal");
  });

  it("without maxPlayers, never returns low", () => {
    expect(getSpotsUrgency(20)).toBe("normal");
    expect(getSpotsUrgency(4)).toBe("normal");
  });
});

describe("spotsOpenLabel", () => {
  it("says how many spots are open", () => {
    expect(spotsOpenLabel(10)).toBe("10 spots open");
    expect(spotsOpenLabel(1)).toBe("1 spot open");
  });

  it("says Full when nothing is left", () => {
    expect(spotsOpenLabel(0)).toBe("Full");
    expect(spotsOpenLabel(-2, { short: true })).toBe("Full");
  });

  it("has a short form for tight rows", () => {
    expect(spotsOpenLabel(7, { short: true })).toBe("7 open");
  });
});

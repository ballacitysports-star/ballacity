import { describe, it, expect } from "vitest";
import { GAMES, SPORTS, imageFor, type Sport } from "./sample-data";

describe("sport cover consistency", () => {
  it("resolves a non-empty cover for every sport", () => {
    for (const { name } of SPORTS) {
      const url = imageFor(name);
      expect(url, `imageFor(${name}) should be defined`).toBeTruthy();
      expect(typeof url).toBe("string");
    }
  });

  it("returns a stable URL for repeated lookups (single source of truth)", () => {
    for (const { name } of SPORTS) {
      expect(imageFor(name)).toBe(imageFor(name));
    }
  });

  it("every sample game's feed/discovery cover matches imageFor(sport)", () => {
    const mismatches: string[] = [];
    for (const g of GAMES) {
      const expected = imageFor(g.sport);
      if (g.image !== expected) {
        mismatches.push(`${g.id} (${g.sport}): got ${g.image}, expected ${expected}`);
      }
    }
    expect(mismatches, mismatches.join("\n")).toEqual([]);
  });

  it("no two sports share the same cover asset", () => {
    const seen = new Map<string, Sport>();
    const dupes: string[] = [];
    for (const { name } of SPORTS) {
      const url = imageFor(name);
      const prior = seen.get(url);
      if (prior) dupes.push(`${name} and ${prior} share ${url}`);
      else seen.set(url, name);
    }
    expect(dupes, dupes.join("\n")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { publicDiscoveryNote } from "@/lib/game-age-visibility";
import { gameAgeRangeIsAdultOnly } from "@/lib/city-seo";

describe("publicDiscoveryNote", () => {
  it.each([
    [null, null, "unset"],
    [18, null, "eligible"],
    [21, null, "eligible"],
    [21, 40, "eligible"],
    [18, 18, "eligible"],
    [13, null, "includes_minors"],
    [16, null, "includes_minors"],
    [16, 30, "includes_minors"],
    [8, 12, "includes_minors"],
    [17, 40, "includes_minors"],
    [null, 17, "no_minimum"],
    [null, 40, "no_minimum"],
    [40, 30, "invalid"],
    [30, 12, "invalid"],
  ] as const)("range %s-%s is %s", (minAge, maxAge, kind) => {
    expect(publicDiscoveryNote({ minAge, maxAge }).kind).toBe(kind);
  });

  it("says a game is eligible exactly when the shared adult-only rule does", () => {
    for (let min = -1; min <= 30; min++) {
      for (const max of [null, 5, 17, 18, 21, 40]) {
        const m = min === -1 ? null : min;
        expect(publicDiscoveryNote({ minAge: m, maxAge: max }).kind === "eligible").toBe(
          gameAgeRangeIsAdultOnly({ min_age: m, max_age: max }),
        );
      }
    }
  });

  it("never promises that an eligible range makes the game public", () => {
    const { text } = publicDiscoveryNote({ minAge: 18, maxAge: null });
    expect(text).toMatch(/can appear/);
    expect(text).toMatch(/public and is not hidden or cancelled/);
    expect(text).not.toMatch(/will appear|automatically/i);
  });

  it("does not make public-eligibility claims for an inverted range", () => {
    const { text } = publicDiscoveryNote({ minAge: 40, maxAge: 30 });
    expect(text).not.toMatch(/discovery/);
  });

  it("does not describe signed-in access", () => {
    for (const r of [
      { minAge: null, maxAge: null },
      { minAge: 21, maxAge: null },
      { minAge: 16, maxAge: 30 },
    ]) {
      expect(publicDiscoveryNote(r).text).not.toMatch(/signed-in|members|everyone/i);
    }
  });
});

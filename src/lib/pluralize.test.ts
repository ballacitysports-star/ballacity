import { describe, expect, it } from "vitest";
import { pluralize, pluralWord } from "./pluralize";

describe("pluralize", () => {
  it("uses the singular for exactly one", () => {
    expect(pluralize(1, "game")).toBe("1 game");
  });

  it("uses the plural for zero and for more than one", () => {
    expect(pluralize(0, "game")).toBe("0 games");
    expect(pluralize(2, "game")).toBe("2 games");
  });

  it("takes an irregular plural", () => {
    expect(pluralize(1, "person", "people")).toBe("1 person");
    expect(pluralize(3, "person", "people")).toBe("3 people");
  });

  it("returns only the noun from pluralWord", () => {
    expect(pluralWord(1, "spot")).toBe("spot");
    expect(pluralWord(4, "spot")).toBe("spots");
  });
});

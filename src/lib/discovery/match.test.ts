import { describe, expect, it } from "vitest";
import {
  EXACT_DUPLICATE,
  findDuplicate,
  fingerprint,
  handleCandidates,
  nameTokens,
  similarity,
  slugify,
} from "./match";
import { hostKey } from "./urls";

describe("name matching", () => {
  it("ignores case, punctuation, accents and filler words", () => {
    expect(similarity("The Atlanta Hoops Academy, LLC", "atlanta hoops academy")).toBe(1);
    expect(similarity("Café Ball & Co.", "Cafe Ball and Co")).toBe(1);
    expect(nameTokens("The Hoops of Atlanta Inc")).toEqual(["hoops", "atlanta"]);
  });

  it("scores different organizations low and partial overlaps in between", () => {
    expect(similarity("Peach State Hoops", "Georgia Soccer Club")).toBe(0);
    const s = similarity("Atlanta Elite Basketball", "Atlanta Elite Basketball Club");
    expect(s).toBeGreaterThan(0.7);
    expect(s).toBeLessThan(1);
    expect(similarity("", "x")).toBe(0);
  });

  it("makes a stable fingerprint regardless of word order and filler", () => {
    expect(fingerprint("gym", "The Hoops Academy", "Atlanta")).toBe(
      fingerprint("gym", "Academy Hoops LLC", "atlanta"),
    );
    expect(fingerprint("gym", "Hoops", "Atlanta")).not.toBe(
      fingerprint("team", "Hoops", "Atlanta"),
    );
  });
});

describe("findDuplicate", () => {
  const known = [
    {
      kind: "gym" as const,
      id: "g1",
      name: "Atlanta Hoops Academy",
      city: "Atlanta",
      website: "https://www.atlhoops.com/about",
    },
    {
      kind: "gym" as const,
      id: "g2",
      name: "Savannah Hoops Academy",
      city: "Savannah",
      website: null,
    },
  ];

  it("finds an exact repeat", () => {
    const hit = findDuplicate(
      { name: "Atlanta Hoops Academy LLC", city: "Atlanta" },
      known,
      hostKey,
    );
    expect(hit?.id).toBe("g1");
    expect(hit!.score).toBeGreaterThanOrEqual(EXACT_DUPLICATE);
  });

  it("lowers the score when the city differs, since chains repeat names across towns", () => {
    const hit = findDuplicate({ name: "Atlanta Hoops Academy", city: "Marietta" }, known, hostKey);
    expect(hit?.id).toBe("g1");
    expect(hit!.score).toBeLessThan(EXACT_DUPLICATE);
  });

  it("treats the same website as a match even when the name differs", () => {
    const hit = findDuplicate(
      { name: "ATL Hoops", city: "Atlanta", websiteHost: "atlhoops.com" },
      known,
      hostKey,
    );
    expect(hit?.id).toBe("g1");
  });

  it("returns nothing for an unrelated name", () => {
    expect(findDuplicate({ name: "Peach Soccer", city: "Atlanta" }, known, hostKey)).toBeNull();
  });
});

describe("handles", () => {
  it("builds url-safe handles and fallbacks", () => {
    expect(slugify("Peach State Hoops!")).toBe("peach-state-hoops");
    expect(handleCandidates("Peach State Hoops", "Atlanta", 4)).toEqual([
      "peach-state-hoops",
      "peach-state-hoops-atlanta",
      "peach-state-hoops-2",
      "peach-state-hoops-3",
    ]);
    expect(handleCandidates("!!!", null, 2)).toEqual(["listing", "listing-2"]);
  });
});

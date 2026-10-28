import { describe, expect, it } from "vitest";
import { feedEmptyKind } from "./feed-empty";

const base = { loading: false, failed: false, totalGames: 12, query: "", filtersActive: false };

describe("feedEmptyKind", () => {
  it("is loading, not empty, until the first load finishes", () => {
    expect(feedEmptyKind({ ...base, loading: true, totalGames: 0 })).toBe("loading");
  });

  it("is an error when the first load failed and nothing is cached", () => {
    expect(feedEmptyKind({ ...base, failed: true, totalGames: 0 })).toBe("error");
    // A failure beats 'still loading': the retry has already given up.
    expect(feedEmptyKind({ ...base, failed: true, loading: true, totalGames: 0 })).toBe("error");
  });

  it("says there are no games yet when none exist at all", () => {
    expect(feedEmptyKind({ ...base, totalGames: 0 })).toBe("none-yet");
  });

  it("blames the search when there is one, and the filters only when some are on", () => {
    expect(feedEmptyKind({ ...base, query: "hoops", filtersActive: true })).toBe("search");
    expect(feedEmptyKind({ ...base, filtersActive: true })).toBe("filters");
  });

  it("does not blame filters that are not on", () => {
    expect(feedEmptyKind({ ...base, filtersActive: false })).toBe("none-yet");
  });

  it("never reports an error or loading once games are on hand", () => {
    expect(feedEmptyKind({ ...base, failed: true, filtersActive: true })).toBe("filters");
    expect(feedEmptyKind({ ...base, loading: true, query: "x" })).toBe("search");
  });

  it("treats a blank search as no search", () => {
    expect(feedEmptyKind({ ...base, query: "   ", filtersActive: true })).toBe("filters");
  });
});

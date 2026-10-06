import { describe, expect, it } from "vitest";
import { MAX_FEATURED_ORGS, canFeatureAnother, isFeatured } from "@/lib/featured-orgs";

describe("featured facilities", () => {
  it("caps how many can be featured at once", () => {
    expect(MAX_FEATURED_ORGS).toBe(6);
    expect(canFeatureAnother(0)).toBe(true);
    expect(canFeatureAnother(MAX_FEATURED_ORGS - 1)).toBe(true);
    expect(canFeatureAnother(MAX_FEATURED_ORGS)).toBe(false);
    expect(canFeatureAnother(MAX_FEATURED_ORGS + 3)).toBe(false);
  });

  it("treats a featured_at timestamp as featured", () => {
    expect(isFeatured({ featured_at: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(isFeatured({ featured_at: null })).toBe(false);
    expect(isFeatured({})).toBe(false);
  });
});

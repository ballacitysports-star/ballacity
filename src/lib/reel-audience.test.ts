import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { REEL_AUDIENCE_OPTIONS, reelAudienceChoices, shownReelAudience } from "./privacy";

describe("reelAudienceChoices", () => {
  it("offers adults all three, and a missing age the adult default", () => {
    expect(reelAudienceChoices("adult")).toEqual(["public", "followers", "private"]);
    expect(reelAudienceChoices("unknown")).toEqual(["public", "followers", "private"]);
    expect(reelAudienceChoices(undefined)).toEqual(["public", "followers", "private"]);
  });

  it("never offers 16-17 'everyone'", () => {
    expect(reelAudienceChoices("teen_16_17")).toEqual(["followers", "private"]);
  });

  it("offers under 16 no choice at all", () => {
    expect(reelAudienceChoices("teen_13_15")).toEqual([]);
    expect(reelAudienceChoices("child_under_13")).toEqual([]);
  });

  it("has a label and description for every choice it can offer", () => {
    for (const v of reelAudienceChoices("adult")) {
      const o = REEL_AUDIENCE_OPTIONS.find((x) => x.value === v);
      expect(o?.label).toBeTruthy();
      expect(o?.description).toBeTruthy();
    }
  });
});

describe("shownReelAudience", () => {
  it("shows an adult's own choice", () => {
    expect(shownReelAudience("followers", "adult")).toBe("followers");
    expect(shownReelAudience("public", "adult")).toBe("public");
  });

  it("shows a minor's stored 'public' as private, matching what the database applies", () => {
    expect(shownReelAudience("public", "teen_16_17")).toBe("private");
    expect(shownReelAudience("followers", "teen_16_17")).toBe("followers");
    expect(shownReelAudience("followers", "teen_13_15")).toBe("private");
    expect(shownReelAudience("public", "child_under_13")).toBe("private");
  });
});

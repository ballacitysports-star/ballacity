import { describe, expect, it } from "vitest";
import { reelPrivacyFor } from "@/lib/reel-privacy";

describe("reelPrivacyFor", () => {
  it("13-15 own upload: guardian-only default, team share locked for the player", () => {
    const p = reelPrivacyFor("teen_13_15");
    expect(p.guardianControlled).toBe(true);
    expect(p.options[0]).toMatchObject({ label: "Guardian only", isDefault: true });
    expect(p.options[1]).toMatchObject({ locked: true });
    expect(p.detail).toContain("Highlights");
  });
  it("guardian family post unlocks team share", () => {
    expect(reelPrivacyFor("teen_13_15", { familyPost: true }).options[1].locked).toBe(false);
  });
  it("16-17 and adults get no guardian selector", () => {
    expect(reelPrivacyFor("teen_16_17").options).toHaveLength(0);
    expect(reelPrivacyFor("adult").summary).toContain("public Highlights");
  });
});

describe("adult reel privacy copy", () => {
  it("describes drafts and public posts only, with no team-only or members option", () => {
    const p = reelPrivacyFor("adult");
    const text = `${p.summary} ${p.detail}`.toLowerCase();
    expect(text).toContain("public");
    expect(text).not.toContain("team-only");
    expect(text).not.toContain("members");
  });
});

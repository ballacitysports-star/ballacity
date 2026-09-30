import { describe, expect, it } from "vitest";
import {
  DEFAULT_REEL_STYLE,
  defaultReelStyleForSport,
  isReelTransition,
  normalizeReelStyle,
  reelStyleDirectives,
  reelStyleSummary,
  sameAiStyle,
} from "@/lib/reel-style";

describe("reel style transitions", () => {
  it("keeps a valid transition", () => {
    expect(normalizeReelStyle({ vibe: "hype", transition: "whip" }).transition).toBe("whip");
  });

  it("gives styles saved before transitions existed the one matching their vibe", () => {
    // Reel rows and localStorage written before this field was added.
    expect(normalizeReelStyle({ vibe: "hype" }).transition).toBe("flash");
    expect(normalizeReelStyle({ vibe: "cinematic" }).transition).toBe("fade");
    expect(normalizeReelStyle({ vibe: "broadcast" }).transition).toBe("whip");
    expect(normalizeReelStyle({ vibe: "documentary" }).transition).toBe("cut");
  });

  it("replaces an unknown transition with the vibe's own", () => {
    expect(normalizeReelStyle({ vibe: "cinematic", transition: "spin" }).transition).toBe("fade");
    expect(normalizeReelStyle(null)).toEqual(DEFAULT_REEL_STYLE);
  });

  it("recognises only the offered transitions", () => {
    expect(isReelTransition("zoom")).toBe(true);
    expect(isReelTransition("spin")).toBe(false);
    expect(isReelTransition(undefined)).toBe(false);
  });

  it("treats a transition-only change as the same AI style", () => {
    const saved = { vibe: "hype", pacing: "punchy", overlayTheme: "bold", transition: "flash" };
    expect(sameAiStyle(saved, { ...saved, transition: "zoom" })).toBe(true);
    expect(sameAiStyle(saved, { ...saved, pacing: "balanced" })).toBe(false);
    expect(sameAiStyle(saved, { ...saved, overlayTheme: "minimal" })).toBe(false);
  });

  it("names the transition in the summary and the cut-list directive", () => {
    const style = normalizeReelStyle({
      vibe: "hype",
      pacing: "balanced",
      transition: "zoom",
      overlayTheme: "scoreboard",
    });
    expect(reelStyleSummary(style)).toBe("Hype · Balanced · Zoom punch · Scoreboard overlays");
    const directives = reelStyleDirectives(style);
    expect(directives.edit).toContain("ZOOM PUNCH");
    // Copy is written the same whatever plays between cuts.
    expect(directives.copy).not.toContain("ZOOM PUNCH");
  });

  it("seeds each sport's transition from its default vibe", () => {
    expect(defaultReelStyleForSport("Tennis").transition).toBe("fade");
    expect(defaultReelStyleForSport("Baseball").transition).toBe("whip");
    expect(defaultReelStyleForSport("Basketball").transition).toBe("flash");
    expect(defaultReelStyleForSport(null)).toEqual(DEFAULT_REEL_STYLE);
  });
});

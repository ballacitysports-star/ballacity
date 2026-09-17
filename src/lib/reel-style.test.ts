import { describe, expect, it } from "vitest";
import {
  DEFAULT_REEL_STYLE,
  TRANSITION_OPTIONS,
  normalizeReelStyle,
  reelStyleDirectives,
  reelStyleSummary,
} from "@/lib/reel-style";

describe("reel transition style", () => {
  it("defaults to a hard cut — the behavior every reel had before this existed", () => {
    expect(DEFAULT_REEL_STYLE.transition).toBe("cut");
    expect(normalizeReelStyle(undefined).transition).toBe("cut");
    expect(normalizeReelStyle(null).transition).toBe("cut");
  });

  it("falls back saved prefs with no `transition` field to cut, not garbage", () => {
    // This is the exact shape a style_prefs row saved before this feature
    // existed has: vibe/pacing/overlayTheme only.
    const legacy = { vibe: "cinematic", pacing: "slowburn", overlayTheme: "minimal" };
    expect(normalizeReelStyle(legacy)).toEqual({
      vibe: "cinematic",
      pacing: "slowburn",
      overlayTheme: "minimal",
      transition: "cut",
    });
  });

  it("rejects an unrecognized transition value rather than storing it", () => {
    expect(normalizeReelStyle({ transition: "wipe-left" }).transition).toBe("cut");
  });

  it("accepts each real transition value", () => {
    for (const opt of TRANSITION_OPTIONS) {
      expect(normalizeReelStyle({ transition: opt.value }).transition).toBe(opt.value);
    }
  });

  it("feeds the cut-list prompt so segment length can match the transition", () => {
    const cut = reelStyleDirectives({ transition: "cut" });
    const fade = reelStyleDirectives({ transition: "fade" });
    expect(cut.edit).toContain("HARD CUTS");
    expect(fade.edit).toContain("SOFT FADE");
    // Copy-writing steps have nothing to do with how cuts are rendered.
    expect(cut.copy).not.toContain("CUTS");
    expect(fade.copy).not.toContain("FADE");
  });

  it("does not clutter the one-line style summary shown in the UI", () => {
    // vibe · pacing · overlay only — transition has its own chip group and
    // doesn't need to repeat in the compact badge.
    expect(reelStyleSummary(DEFAULT_REEL_STYLE)).toBe("Hype · Balanced · Scoreboard overlays");
  });
});

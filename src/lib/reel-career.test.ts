/**
 * Career report parsing, and the cover-art feature routing.
 *
 * The routing test matters most: `coverFeatureFor` is what keeps a minor from
 * being handed free-form text-to-image. If it ever returns `image_generate` for
 * a reel that has a frame, the cohort policy for generation stops applying.
 */

import { describe, expect, it, vi } from "vitest";
import { buildCareerGrounding, generateCareerReport } from "./reel-career.server";
import { coverFeatureFor, pickSourceFrame } from "./reel-cover.server";
import {
  DEFAULT_AI_FEATURES,
  DEFAULT_AI_LIMITS,
  DEFAULT_AI_PRICING,
  DEFAULT_AI_PROVIDER,
  type AiConfig,
} from "./ai/config";
import type { AiSession } from "./ai/gate.server";

function config(): AiConfig {
  return {
    features: structuredClone(DEFAULT_AI_FEATURES),
    limits: structuredClone(DEFAULT_AI_LIMITS),
    provider: { ...DEFAULT_AI_PROVIDER },
    pricing: structuredClone(DEFAULT_AI_PRICING),
  };
}

function sessionReturning(payload: unknown): AiSession {
  return {
    admin: { from: () => ({ insert: async () => ({}) }) },
    userId: "u1",
    feature: "reel_career",
    jobId: null,
    tier: "free",
    cohort: "adult",
    limits: DEFAULT_AI_LIMITS.free,
    config: config(),
    provider: {
      name: "test",
      generateStructured: vi.fn(async () => ({
        data: payload,
        model: "test-model",
        usage: { inputTokens: 1, outputTokens: 1 },
      })),
    } as any,
  } as AiSession;
}

const REELS = [
  {
    id: "r2",
    title: "Later",
    ai_sport: "basketball",
    created_at: "2026-09-10T00:00:00Z",
    ai_analysis: { summary: "drives the lane" },
    ai_coaching: { strengths: ["first step"], notes: ["left hand"] },
  },
  {
    id: "r1",
    title: "Earlier",
    ai_sport: "basketball",
    created_at: "2026-08-01T00:00:00Z",
    ai_analysis: { summary: "spot-up shooting" },
  },
];

describe("buildCareerGrounding", () => {
  it("orders reels oldest first so a trend reads forward in time", () => {
    const text = buildCareerGrounding(REELS);
    expect(text.indexOf("Earlier")).toBeLessThan(text.indexOf("Later"));
  });

  it("numbers each reel and keeps its date", () => {
    const text = buildCareerGrounding(REELS);
    expect(text).toContain("1. [2026-08-01]");
    expect(text).toContain("2. [2026-09-10]");
  });
});

describe("generateCareerReport", () => {
  it("keeps a well-formed report and reports the window", async () => {
    const session = sessionReturning({
      sport: "basketball",
      headline: "Strong finisher, still one-handed.",
      strengths: [{ skill: "first step", evidence: "both reels" }],
      fixes: [{ issue: "left hand", why: "defenders overplay", drill: "weak-hand finishes" }],
      trend: { direction: "improving", note: "cleaner by September" },
      next_session: ["10 minutes weak hand"],
      filming_tips: [],
    });
    const out = await generateCareerReport(REELS, { session });

    expect(out.reelsAnalyzed).toBe(2);
    expect(out.window).toEqual({ from: "2026-08-01", to: "2026-09-10" });
    expect(out.trend.direction).toBe("improving");
    expect(out.strengths[0].skill).toBe("first step");
    expect(out.fixes[0].drill).toBe("weak-hand finishes");
  });

  it("falls back to 'unclear' for a trend direction it does not recognise", async () => {
    const session = sessionReturning({
      headline: "Mixed bag.",
      trend: { direction: "vibes", note: "" },
    });
    const out = await generateCareerReport(REELS, { session });
    expect(out.trend.direction).toBe("unclear");
  });

  it("falls back to the dominant sport when the model omits one", async () => {
    const session = sessionReturning({ headline: "Fine.", sport: null });
    const out = await generateCareerReport(REELS, { session });
    expect(out.sport).toBe("basketball");
  });

  it("drops malformed strengths and fixes instead of surfacing blanks", async () => {
    const session = sessionReturning({
      headline: "Fine.",
      strengths: [{ evidence: "no skill named" }, { skill: "handles", evidence: "r1" }],
      fixes: [{ why: "no issue named" }],
    });
    const out = await generateCareerReport(REELS, { session });
    expect(out.strengths).toHaveLength(1);
    expect(out.strengths[0].skill).toBe("handles");
    expect(out.fixes).toHaveLength(0);
  });

  it("throws when the report came back with nothing in it", async () => {
    const session = sessionReturning({ headline: "", strengths: [], fixes: [] });
    await expect(generateCareerReport(REELS, { session })).rejects.toThrow(/empty/i);
  });

  it("throws before calling the model when no reel has any analysis", async () => {
    const session = sessionReturning({});
    await expect(generateCareerReport([], { session })).rejects.toThrow(/no AI analysis/i);
    expect(session.provider.generateStructured).not.toHaveBeenCalled();
  });
});

describe("cover art feature routing", () => {
  it("edits an existing thumbnail rather than generating from scratch", () => {
    const reel = { thumbnail_path: "u1/thumb.jpg", frame_paths: ["u1/f1.jpg"] };
    expect(pickSourceFrame(reel)).toBe("u1/thumb.jpg");
    expect(coverFeatureFor(reel)).toBe("image_enhance");
  });

  it("uses a sampled frame when there is no thumbnail yet", () => {
    const reel = { frame_paths: ["u1/a.jpg", "u1/b.jpg", "u1/c.jpg"] };
    expect(pickSourceFrame(reel)).toBe("u1/b.jpg");
    expect(coverFeatureFor(reel)).toBe("image_enhance");
  });

  it("only falls back to free-form generation when there is no frame at all", () => {
    expect(coverFeatureFor({ frame_paths: [] })).toBe("image_generate");
    expect(coverFeatureFor({})).toBe("image_generate");
  });

  it("ignores a blank thumbnail path", () => {
    expect(pickSourceFrame({ thumbnail_path: "", frame_paths: ["u1/a.jpg"] })).toBe("u1/a.jpg");
  });
});

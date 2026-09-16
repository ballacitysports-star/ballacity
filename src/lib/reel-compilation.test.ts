/**
 * Compilation clip validation.
 *
 * The model proposes clips; this layer decides which survive. These tests cover
 * the parts that must not depend on the model behaving: a clip may only name a
 * reel the caller owns, and it may only span time that reel actually has.
 */

import { describe, expect, it, vi } from "vitest";
import {
  COMPILATION_MIN_REELS,
  generateCompilation,
  reelDuration,
} from "./reel-compilation.server";
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

/** Session whose provider returns exactly the payload a test supplies. */
function sessionReturning(payload: unknown): AiSession {
  return {
    admin: { from: () => ({ insert: async () => ({}) }) },
    userId: "u1",
    feature: "reel_compilation",
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

function reel(id: string, duration: number): Record<string, any> {
  return {
    id,
    title: `Reel ${id}`,
    ai_sport: "basketball",
    ai_moments: [{ t: 2, label: "drive" }],
    media_meta: { durationSeconds: duration },
    created_at: "2026-09-01T00:00:00Z",
  };
}

describe("reelDuration", () => {
  it("prefers the probed duration", () => {
    expect(reelDuration({ media_meta: { durationSeconds: 12.5 }, frame_times: [1, 2] })).toBe(12.5);
  });

  it("falls back to the last sampled frame time", () => {
    expect(reelDuration({ media_meta: {}, frame_times: [1, 9, 4] })).toBe(9);
  });

  it("is null when neither is known", () => {
    expect(reelDuration({})).toBeNull();
    expect(reelDuration({ media_meta: { durationSeconds: 0 }, frame_times: [] })).toBeNull();
  });
});

describe("generateCompilation clip validation", () => {
  const reels = [reel("a", 10), reel("b", 20)];

  it("drops a clip naming a reel the caller does not own", async () => {
    const session = sessionReturning({
      title: "Best of",
      clips: [
        { reel_id: "not-mine", start: 1, end: 3 },
        { reel_id: "a", start: 1, end: 3 },
      ],
    });
    const out = await generateCompilation(reels, { session });
    expect(out.clips).toHaveLength(1);
    expect(out.clips[0].reelId).toBe("a");
  });

  it("clamps a clip that runs past the end of its reel", async () => {
    const session = sessionReturning({ clips: [{ reel_id: "a", start: 8, end: 400 }] });
    const out = await generateCompilation(reels, { session });
    expect(out.clips[0].end).toBeLessThanOrEqual(10);
    expect(out.clips[0].start).toBeGreaterThanOrEqual(0);
  });

  it("caps a single clip at the maximum length", async () => {
    const session = sessionReturning({ clips: [{ reel_id: "b", start: 0, end: 20 }] });
    const out = await generateCompilation(reels, { session });
    expect(out.clips[0].end - out.clips[0].start).toBeLessThanOrEqual(12);
  });

  it("repairs a backwards or zero-length range", async () => {
    const session = sessionReturning({ clips: [{ reel_id: "a", start: 5, end: 5 }] });
    const out = await generateCompilation(reels, { session });
    expect(out.clips[0].end).toBeGreaterThan(out.clips[0].start);
  });

  it("falls back to a normal pace for an unknown pace value", async () => {
    const session = sessionReturning({
      clips: [{ reel_id: "a", start: 1, end: 3, pace: "explode" }],
    });
    const out = await generateCompilation(reels, { session });
    expect(out.clips[0].pace).toBe("normal");
  });

  it("reports the total of the kept clips only", async () => {
    const session = sessionReturning({
      clips: [
        { reel_id: "a", start: 0, end: 2 },
        { reel_id: "ghost", start: 0, end: 5 },
        { reel_id: "b", start: 1, end: 4 },
      ],
    });
    const out = await generateCompilation(reels, { session });
    expect(out.clips).toHaveLength(2);
    expect(out.totalSeconds).toBeCloseTo(5, 2);
    expect(out.reelIds).toEqual(["a", "b"]);
  });

  it("throws when every proposed clip was rejected", async () => {
    const session = sessionReturning({ clips: [{ reel_id: "ghost", start: 0, end: 5 }] });
    await expect(generateCompilation(reels, { session })).rejects.toThrow(/no usable clips/i);
  });

  it("refuses to run below the minimum number of usable reels", async () => {
    const session = sessionReturning({ clips: [] });
    // Only one reel has a known duration, so the window is too small.
    await expect(
      generateCompilation([reel("a", 10), { id: "b", title: "no duration" }], { session }),
    ).rejects.toThrow(new RegExp(`at least ${COMPILATION_MIN_REELS}`, "i"));
    expect(session.provider.generateStructured).not.toHaveBeenCalled();
  });
});

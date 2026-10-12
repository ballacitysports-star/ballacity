import { describe, expect, it } from "vitest";
import {
  LM,
  angleDeg,
  normalizePoseMetrics,
  poseAllowedForCohort,
  poseGrounding,
  summarizePose,
  type Landmark,
  type PoseFrame,
} from "@/lib/pose-metrics";

/** A standing figure; y grows downward. `lift` raises the whole body, `knee` bends the knees. */
function figure(t: number, o: { lift?: number; kneeBend?: boolean; wristY?: number; vis?: number } = {}): PoseFrame {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: o.vis ?? 1 }));
  const L = o.lift ?? 0;
  const set = (i: number, x: number, y: number) => (lm[i] = { x, y: y - L, visibility: o.vis ?? 1 });
  set(LM.leftShoulder, 0.45, 0.3);
  set(LM.rightShoulder, 0.55, 0.3);
  set(LM.leftHip, 0.46, 0.5);
  set(LM.rightHip, 0.54, 0.5);
  // Torso length = 0.2.
  if (o.kneeBend) {
    set(LM.leftKnee, 0.62, 0.65);
    set(LM.rightKnee, 0.62, 0.65);
  } else {
    set(LM.leftKnee, 0.46, 0.7);
    set(LM.rightKnee, 0.54, 0.7);
  }
  set(LM.leftAnkle, 0.46, 0.9);
  set(LM.rightAnkle, 0.54, 0.9);
  set(LM.leftElbow, 0.4, 0.4);
  set(LM.rightElbow, 0.6, 0.4);
  set(LM.leftWrist, 0.4, o.wristY ?? 0.5);
  set(LM.rightWrist, 0.6, o.wristY ?? 0.5);
  return { t, landmarks: lm };
}

describe("angleDeg", () => {
  it("measures right angles, straight lines and degenerate input", () => {
    expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(angleDeg({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(180);
    expect(angleDeg({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNaN();
  });
});

describe("poseAllowedForCohort", () => {
  it("measures only adults and 16-17", () => {
    expect(poseAllowedForCohort("adult")).toBe(true);
    expect(poseAllowedForCohort("teen_16_17")).toBe(true);
    for (const c of ["teen_13_15", "child_under_13", "unknown", null, undefined]) {
      expect(poseAllowedForCohort(c)).toBe(false);
    }
  });
});

describe("summarizePose", () => {
  it("returns null with nothing to measure", () => {
    expect(summarizePose([])).toBeNull();
    expect(summarizePose([figure(0, { vis: 0.1 })])).toBeNull();
  });

  it("measures a jump in torso lengths", () => {
    const frames = [...Array(8)].map((_, i) => figure(i * 0.1, { lift: i === 5 ? 0.2 : 0 }));
    const m = summarizePose(frames)!;
    expect(m.coverage).toBe(1);
    expect(m.jumpRiseTorsos).toBeCloseTo(1, 1); // 0.2 rise / 0.2 torso
  });

  it("leaves the jump out when there are too few frames", () => {
    expect(summarizePose([figure(0), figure(0.1, { lift: 0.2 })])!.jumpRiseTorsos).toBeNull();
  });

  it("finds the deepest knee bend and the highest wrist", () => {
    const frames = [figure(0), figure(0.5, { kneeBend: true }), figure(1, { wristY: 0.1 })];
    const m = summarizePose(frames)!;
    expect(m.kneeBendMin!.t).toBe(0.5);
    expect(m.kneeBendMin!.deg).toBeLessThan(160);
    expect(m.release!.t).toBe(1);
    expect(m.release!.wristAboveHipsTorsos).toBeCloseTo(2, 1); // (0.5 - 0.1) / 0.2
  });

  it("skips frames where the body is not tracked and reports coverage", () => {
    const m = summarizePose([figure(0), figure(1, { vis: 0.1 }), figure(2), figure(3, { vis: 0.1 })])!;
    expect(m.coverage).toBe(0.5);
    expect(m.frames).toBe(4);
  });
});

describe("normalizePoseMetrics and poseGrounding", () => {
  const good = summarizePose([figure(0), figure(0.5, { kneeBend: true }), figure(1, { wristY: 0.1 }), figure(1.5)])!;

  it("round-trips real output and drops junk", () => {
    expect(normalizePoseMetrics(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(normalizePoseMetrics(null)).toBeNull();
    expect(normalizePoseMetrics({ version: 2 })).toBeNull();
    expect(normalizePoseMetrics({ version: 1, frames: 0, coverage: 1 })).toBeNull();
    expect(normalizePoseMetrics({ version: 1, frames: 5, coverage: 9, sway: "x" })!.coverage).toBe(1);
  });

  it("writes grounding only when the tracker saw enough of the clip", () => {
    expect(poseGrounding(good)).toContain("deepest knee bend");
    expect(poseGrounding(good)).toContain("do not invent other measurements");
    expect(poseGrounding({ ...good, coverage: 0.2 })).toBe("");
    expect(poseGrounding(null)).toBe("");
  });
});

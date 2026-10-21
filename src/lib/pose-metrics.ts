/**
 * Body measurements from pose landmarks, so Pro Analytics can quote numbers instead of
 * eyeballing stills.
 *
 * Pure: takes landmark frames in the common 33-point layout (MediaPipe Pose: image
 * coordinates, y grows downward) and returns a few robust, scale-free measurements.
 * Where the landmarks come from (an in-browser model) is deliberately not decided here.
 *
 * Distances are in torso lengths because the camera distance is unknown; they are
 * estimates, and the confidence field says how much of the clip the tracker saw.
 * For now this is used only for adults and 16-17: never for anyone under 16.
 */

import type { AgeCohort } from "@/lib/child-policy";

export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

export type Landmark = { x: number; y: number; visibility?: number };
export type PoseFrame = { t: number; landmarks: Landmark[] };

export type PoseMetrics = {
  version: 1;
  frames: number;
  /** Share of frames where the body was tracked well enough to measure, 0-1. */
  coverage: number;
  /** Peak hip rise above the standing level, in torso lengths. Null if too few frames. */
  jumpRiseTorsos: number | null;
  /** Deepest knee bend in degrees (180 is straight) and when it happened. */
  kneeBendMin: { deg: number; t: number } | null;
  /** The highest the wrist got: elbow angle then, and wrist height above the hips in torso lengths. */
  release: { t: number; elbowDeg: number; wristAboveHipsTorsos: number } | null;
  /** Side-to-side lean of the upper body against the hips, in torso lengths (lower is steadier). */
  sway: number | null;
};

const MIN_VISIBILITY = 0.5;
const MIN_FRAMES_FOR_JUMP = 8;

/** Only adults and 16-17 are measured. */
export function poseAllowedForCohort(cohort: AgeCohort | string | null | undefined): boolean {
  return cohort === "adult" || cohort === "teen_16_17";
}

export function angleDeg(a: Landmark, b: Landmark, c: Landmark): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (m === 0) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / m));
  return (Math.acos(cos) * 180) / Math.PI;
}

function ok(l: Landmark | undefined): l is Landmark {
  return !!l && Number.isFinite(l.x) && Number.isFinite(l.y) && (l.visibility ?? 1) >= MIN_VISIBILITY;
}

function mid(a: Landmark, b: Landmark): Landmark {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

type Measured = {
  t: number;
  torso: number;
  hip: Landmark;
  shoulder: Landmark;
  kneeDeg: number | null;
  wrists: { y: number; elbowDeg: number }[];
};

function measure(f: PoseFrame): Measured | null {
  const g = (i: number) => f.landmarks[i];
  const need = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip].map(g);
  if (!need.every(ok)) return null;
  const shoulder = mid(g(LM.leftShoulder), g(LM.rightShoulder));
  const hip = mid(g(LM.leftHip), g(LM.rightHip));
  const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  if (!(torso > 1e-4)) return null;

  const knees: number[] = [];
  for (const [h, k, a] of [
    [LM.leftHip, LM.leftKnee, LM.leftAnkle],
    [LM.rightHip, LM.rightKnee, LM.rightAnkle],
  ] as const) {
    if (ok(g(h)) && ok(g(k)) && ok(g(a))) {
      const d = angleDeg(g(h), g(k), g(a));
      if (Number.isFinite(d)) knees.push(d);
    }
  }
  const wrists: { y: number; elbowDeg: number }[] = [];
  for (const [s, e, w] of [
    [LM.leftShoulder, LM.leftElbow, LM.leftWrist],
    [LM.rightShoulder, LM.rightElbow, LM.rightWrist],
  ] as const) {
    if (ok(g(s)) && ok(g(e)) && ok(g(w))) {
      const d = angleDeg(g(s), g(e), g(w));
      if (Number.isFinite(d)) wrists.push({ y: g(w).y, elbowDeg: d });
    }
  }
  return {
    t: f.t,
    torso,
    hip,
    shoulder,
    kneeDeg: knees.length ? knees.reduce((a, b) => a + b, 0) / knees.length : null,
    wrists,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Null when nothing could be measured. */
export function summarizePose(frames: PoseFrame[]): PoseMetrics | null {
  if (frames.length === 0) return null;
  const ms = frames.map(measure).filter((m): m is Measured => m !== null);
  if (ms.length === 0) return null;
  const torso = median(ms.map((m) => m.torso));

  let jumpRiseTorsos: number | null = null;
  if (ms.length >= MIN_FRAMES_FOR_JUMP) {
    const stand = median(ms.map((m) => m.hip.y));
    const rise = stand - Math.min(...ms.map((m) => m.hip.y));
    jumpRiseTorsos = r2(Math.max(0, rise / torso));
  }

  let kneeBendMin: PoseMetrics["kneeBendMin"] = null;
  for (const m of ms) {
    if (m.kneeDeg != null && (kneeBendMin == null || m.kneeDeg < kneeBendMin.deg)) {
      kneeBendMin = { deg: r1(m.kneeDeg), t: r2(m.t) };
    }
  }

  let release: PoseMetrics["release"] = null;
  let bestY = Infinity;
  for (const m of ms) {
    for (const w of m.wrists) {
      if (w.y < bestY) {
        bestY = w.y;
        release = {
          t: r2(m.t),
          elbowDeg: r1(w.elbowDeg),
          wristAboveHipsTorsos: r2((m.hip.y - w.y) / m.torso),
        };
      }
    }
  }

  const lean = ms.map((m) => (m.shoulder.x - m.hip.x) / m.torso);
  const mean = lean.reduce((a, b) => a + b, 0) / lean.length;
  const sway =
    lean.length >= 3
      ? r2(Math.sqrt(lean.reduce((a, b) => a + (b - mean) ** 2, 0) / lean.length))
      : null;

  return {
    version: 1,
    frames: frames.length,
    coverage: r2(ms.length / frames.length),
    jumpRiseTorsos,
    kneeBendMin,
    release,
    sway,
  };
}

/** Accepts only what summarizePose produces; anything else is dropped. */
export function normalizePoseMetrics(raw: unknown): PoseMetrics | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, any>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const frames = num(o.frames);
  const coverage = num(o.coverage);
  if (o.version !== 1 || frames == null || coverage == null || frames <= 0) return null;
  const knee =
    o.kneeBendMin && num(o.kneeBendMin.deg) != null && num(o.kneeBendMin.t) != null
      ? { deg: o.kneeBendMin.deg as number, t: o.kneeBendMin.t as number }
      : null;
  const rel =
    o.release &&
    num(o.release.t) != null &&
    num(o.release.elbowDeg) != null &&
    num(o.release.wristAboveHipsTorsos) != null
      ? {
          t: o.release.t as number,
          elbowDeg: o.release.elbowDeg as number,
          wristAboveHipsTorsos: o.release.wristAboveHipsTorsos as number,
        }
      : null;
  return {
    version: 1,
    frames,
    coverage: Math.max(0, Math.min(1, coverage)),
    jumpRiseTorsos: num(o.jumpRiseTorsos),
    kneeBendMin: knee,
    release: rel,
    sway: num(o.sway),
  };
}

/** Prompt text: measured facts the model should prefer over guessing from stills. */
export function poseGrounding(p: PoseMetrics | null): string {
  if (!p || p.coverage < 0.4) return "";
  const lines = [
    `Body tracking measured these on ${Math.round(p.coverage * 100)}% of frames (estimates; camera angle and distance affect them):`,
    p.jumpRiseTorsos != null ? `- peak hip rise ${p.jumpRiseTorsos} torso lengths` : "",
    p.kneeBendMin ? `- deepest knee bend ${p.kneeBendMin.deg} degrees at ${p.kneeBendMin.t}s (180 is straight)` : "",
    p.release
      ? `- highest wrist point at ${p.release.t}s: elbow ${p.release.elbowDeg} degrees, wrist ${p.release.wristAboveHipsTorsos} torso lengths above the hips`
      : "",
    p.sway != null ? `- upper-body side lean variation ${p.sway} torso lengths (lower is steadier)` : "",
    "Use these numbers where they apply and do not contradict them; do not invent other measurements.",
  ];
  return lines.filter(Boolean).join("\n");
}

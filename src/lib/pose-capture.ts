/**
 * In-browser body tracking for reel uploads.
 *
 * Runs MediaPipe PoseLandmarker (lite) on evenly spaced stills of the clip and keeps
 * only the summary from `summarizePose`. Raw landmarks never leave this function.
 * Never throws: any failure (model unavailable, codec, timeout) returns null.
 * The library is dynamically imported, so nothing loads until an eligible upload runs.
 */

import { supabase } from "@/integrations/supabase/client";
import { summarizePose, type PoseFrame, type PoseMetrics } from "@/lib/pose-metrics";

export const MEDIAPIPE_VERSION = "0.10.14";
const BUCKET = "app-assets";
const PREFIX = `mediapipe/${MEDIAPIPE_VERSION}`;
const TIMEOUT_MS = 25_000;

/** Evenly spaced sample times inside the clip, avoiding the very first/last frame. */
export function poseSampleTimes(duration: number, count: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || count <= 0) return [];
  const n = Math.floor(count);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = duration * ((i + 0.5) / n);
    out.push(Math.min(Math.max(t, 0), Math.max(duration - 0.05, 0)));
  }
  return out;
}

/** About 24 samples for short clips, 32 for longer ones, never above maxFrames. */
export function poseSampleCount(duration: number, maxFrames = 32): number {
  const base = duration > 20 ? 32 : 24;
  return Math.max(1, Math.min(base, Math.floor(maxFrames)));
}

function bucketUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(`${PREFIX}/${path}`).data.publicUrl;
}

async function reachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Our own storage only. An athlete's browser never calls a third-party host for this, so
 * nothing about them leaks to one. If the files are not there, pose is simply skipped.
 */
async function resolveSources(): Promise<{ wasm: string; model: string } | null> {
  const wasm = bucketUrl("wasm");
  const model = bucketUrl("pose_landmarker_lite.task");
  const [w, m] = await Promise.all([
    reachable(`${wasm}/vision_wasm_internal.wasm`),
    reachable(model),
  ]);
  return w && m ? { wasm, model } : null;
}

/**
 * Storage may label these files application/octet-stream, which a browser can refuse to
 * run as a script or stream as wasm. Re-wrap them as blobs with the right type, the same
 * way the ffmpeg core is loaded in video-transcode.ts, so the label does not matter.
 * Returns the fileset and a cleanup that frees the blob URLs.
 */
async function typedFileset(
  fs: { wasmLoaderPath: string; wasmBinaryPath: string; [k: string]: unknown },
): Promise<{ fileset: typeof fs; free: () => void }> {
  const [js, bin] = await Promise.all([fetch(fs.wasmLoaderPath), fetch(fs.wasmBinaryPath)]);
  if (!js.ok || !bin.ok) throw new Error("pose files unavailable");
  const jsUrl = URL.createObjectURL(new Blob([await js.arrayBuffer()], { type: "text/javascript" }));
  const binUrl = URL.createObjectURL(new Blob([await bin.arrayBuffer()], { type: "application/wasm" }));
  return {
    fileset: { ...fs, wasmLoaderPath: jsUrl, wasmBinaryPath: binUrl },
    free: () => {
      URL.revokeObjectURL(jsUrl);
      URL.revokeObjectURL(binUrl);
    },
  };
}

function seek(video: HTMLVideoElement, t: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", onSeeked);
      resolve(ok);
    };
    const onSeeked = () => finish(true);
    video.addEventListener("seeked", onSeeked);
    setTimeout(() => finish(false), 3000);
    try {
      video.currentTime = t;
    } catch {
      finish(false);
    }
  });
}

function loadVideo(video: HTMLVideoElement): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 8000);
    video.addEventListener("loadeddata", () => (clearTimeout(t), resolve(true)), { once: true });
    video.addEventListener("error", () => (clearTimeout(t), resolve(false)), { once: true });
  });
}

export async function capturePoseMetrics(
  file: Blob,
  opts?: { maxFrames?: number },
): Promise<PoseMetrics | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  let landmarker: { detectForVideo: Function; close: () => void } | null = null;
  let url: string | null = null;
  let video: HTMLVideoElement | null = null;
  let timedOut = false;
  let freeFiles: (() => void) | null = null;
  const timer = setTimeout(() => (timedOut = true), TIMEOUT_MS);

  const run = async (): Promise<PoseMetrics | null> => {
    video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    url = URL.createObjectURL(file);
    video.src = url;
    if (!(await loadVideo(video)) || timedOut) return null;
    const duration = video.duration;
    const times = poseSampleTimes(duration, poseSampleCount(duration, opts?.maxFrames));
    if (times.length === 0) return null;

    const [{ FilesetResolver, PoseLandmarker }, src] = await Promise.all([
      import("@mediapipe/tasks-vision"),
      resolveSources(),
    ]);
    if (timedOut) return null;
    if (!src) return null;
    const resolved = await FilesetResolver.forVisionTasks(src.wasm);
    const typed = await typedFileset(resolved as any);
    freeFiles = typed.free;
    const fileset = typed.fileset as typeof resolved;
    landmarker = (await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: src.model, delegate: "CPU" },
      runningMode: "VIDEO",
      numPoses: 1,
    })) as unknown as typeof landmarker;

    const frames: PoseFrame[] = [];
    let lastTs = -1;
    for (const t of times) {
      if (timedOut) return null;
      if (!(await seek(video, t))) continue;
      // VIDEO mode needs strictly increasing timestamps (ms).
      const ts = Math.max(Math.round(t * 1000), lastTs + 1);
      lastTs = ts;
      const res = landmarker!.detectForVideo(video, ts) as {
        landmarks?: { x: number; y: number; visibility?: number }[][];
      };
      const lm = res?.landmarks?.[0];
      frames.push({
        t,
        landmarks: lm ? lm.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility })) : [],
      });
    }
    return summarizePose(frames);
  };

  try {
    const result = await Promise.race([
      run(),
      new Promise<null>((r) => setTimeout(() => r(null), TIMEOUT_MS + 500)),
    ]);
    return timedOut ? null : result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    try {
      (freeFiles as (() => void) | null)?.();
    } catch {
      /* ignore */
    }
    try {
      (landmarker as { close: () => void } | null)?.close();
    } catch {
      /* ignore */
    }
    const v = video as HTMLVideoElement | null;
    if (v) {
      v.removeAttribute("src");
      v.load();
    }
    if (url) URL.revokeObjectURL(url);
  }
}

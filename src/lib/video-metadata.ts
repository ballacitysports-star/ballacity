/**
 * Browser-side probing of a clip's real shape, and the record we keep of it.
 *
 * The server runtime (Cloudflare Workers) cannot run ffprobe, so everything a
 * viewer later needs to know about a clip — how big it was, how long, which way
 * up, whether we had to convert it — is measured in the uploader and stored as
 * `highlight_reels.media_meta`. Nothing here changes what a clip is allowed to
 * be: `video-validation.ts` still owns the rules.
 */

import type { PoseMetrics } from "@/lib/pose-metrics";

export type ProbedVideo = {
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  orientation: "portrait" | "landscape" | "square" | null;
};

export type MediaMeta = {
  original: {
    filename: string;
    mime: string | null;
    bytes: number;
  } & ProbedVideo;
  processed:
    | ({
        mime: string;
        bytes: number;
        pass: string;
      } & ProbedVideo)
    | null;
  /**
   * `ready` — a converted H.264 copy exists.
   * `original` — the upload was already widely playable, nothing to convert.
   * `failed` — conversion was needed but no pass succeeded; the original stays
   * as the only source, so we never pretend a failure was a success.
   */
  playback_status: "ready" | "original" | "failed";
  playback_error: string | null;
  processed_at: string;
  /** Summary only (never raw landmarks); adults and 16-17, never family clips. */
  pose?: PoseMetrics;
};

/**
 * Reads dimensions, duration and orientation from a clip without decoding the
 * whole file. Resolves with nulls rather than throwing: metadata is a nice
 * record, never a reason to fail an upload.
 */
export function probeVideo(source: Blob, timeoutMs = 8000): Promise<ProbedVideo> {
  const empty: ProbedVideo = {
    width: null,
    height: null,
    durationSeconds: null,
    orientation: null,
  };
  if (typeof window === "undefined") return Promise.resolve(empty);

  return new Promise((resolve) => {
    const url = URL.createObjectURL(source);
    const el = document.createElement("video");
    let settled = false;
    const finish = (value: ProbedVideo) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(empty), timeoutMs);

    el.preload = "metadata";
    el.muted = true;
    el.addEventListener("loadedmetadata", () => {
      const width = el.videoWidth || null;
      const height = el.videoHeight || null;
      const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
      finish({
        width,
        height,
        durationSeconds: duration,
        orientation: orientationOf(width, height),
      });
    });
    el.addEventListener("error", () => finish(empty));
    el.src = url;
  });
}

export function orientationOf(
  width: number | null,
  height: number | null,
): ProbedVideo["orientation"] {
  if (!width || !height) return null;
  if (width === height) return "square";
  return height > width ? "portrait" : "landscape";
}

/** Same shape as {@link MediaMeta}, built from what the uploader observed. */
export function buildMediaMeta(input: {
  file: { name: string; type: string; size: number };
  original: ProbedVideo;
  processed?: ({ bytes: number; pass: string } & ProbedVideo) | null;
  playbackError?: string | null;
  conversionAttempted: boolean;
  /** Summarized body-tracking measurements; omitted from the record when null. */
  pose?: PoseMetrics | null;
}): MediaMeta {
  const processed = input.processed ?? null;
  return {
    original: {
      filename: input.file.name,
      mime: input.file.type || null,
      bytes: input.file.size,
      ...input.original,
    },
    processed: processed ? { mime: "video/mp4", ...processed } : null,
    playback_status: processed ? "ready" : input.conversionAttempted ? "failed" : "original",
    playback_error: processed ? null : (input.playbackError ?? null),
    processed_at: new Date().toISOString(),
    ...(input.pose ? { pose: input.pose } : {}),
  };
}

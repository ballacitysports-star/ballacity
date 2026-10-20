/**
 * In-browser H.264 fallback encoding for highlight reels.
 *
 * The server runtime (Cloudflare Workers) can't run a video encoder — no
 * native binaries, no subprocesses — so clips whose codec Safari/iOS can't
 * decode (VP9/AV1 in an .mp4 wrapper, .webm recordings) are re-encoded in the
 * uploader with ffmpeg.wasm and stored alongside the original as the playback
 * copy (`playback_path` on `highlight_reels`).
 *
 * Everything here is browser-only and loaded dynamically so SSR never touches
 * the wasm bundle.
 */

import { supabase } from "@/integrations/supabase/client";

/**
 * Keep in step with `VERSION` in scripts/upload-ffmpeg-core.mjs, which publishes
 * these two files. The version is part of the storage path, so upgrading means
 * uploading alongside rather than overwriting an object clients cache for a year.
 */
const FFMPEG_CORE_VERSION = "0.12.10";
const CORE_BUCKET = "app-assets";

/**
 * The core is served from our own Storage, not a public CDN.
 *
 * It used to be fetched from unpkg.com on every upload, which made "every reel
 * plays" depend on a third party being reachable at that moment — and once a
 * failed conversion started rejecting the upload outright, an unreachable core
 * stopped non-H.264 clips uploading at all. Bundling it as a static asset is not
 * an option: the wasm is ~30.7 MiB and this deploys as a Cloudflare Worker with
 * assets, capped at 25 MiB per file.
 */
function coreUrl(file: string): string {
  const { data } = supabase.storage
    .from(CORE_BUCKET)
    .getPublicUrl(`ffmpeg/${FFMPEG_CORE_VERSION}/${file}`);
  return data.publicUrl;
}

/** Hard ceiling: encoding in wasm is slow, so skip absurdly large sources. */
export const MAX_TRANSCODE_BYTES = 200 * 1024 * 1024;

/**
 * Thrown when the converter itself is unavailable — the wasm core is missing,
 * unreadable, or blocked — as opposed to a clip this device could not encode.
 *
 * The two look identical to an athlete and need opposite responses: one is a
 * deploy or outage problem nobody can act on from their phone, the other is
 * genuinely about this clip on this device. Callers branch on this to say which.
 */
export class ConverterUnavailableError extends Error {
  constructor(message = "Video conversion is unavailable") {
    super(message);
    this.name = "ConverterUnavailableError";
  }
}

let reachable: Promise<void> | null = null;

/**
 * One cheap, cached check that the core is actually fetchable before we promise
 * an athlete their clip will be converted.
 *
 * Deliberately separate from `convertToPlayableMp4`, whose contract is to
 * swallow every encode failure and return null. Folding this in would blur the
 * distinction this exists to draw. Ranged so it costs a couple of bytes rather
 * than 30 MiB; a server ignoring Range answers 200, which is just as good an
 * answer to "can this be fetched".
 */
export async function assertConverterReachable(): Promise<void> {
  if (!reachable) {
    reachable = (async () => {
      let res: Response;
      try {
        res = await fetch(coreUrl("ffmpeg-core.wasm"), {
          headers: { range: "bytes=0-1" },
        });
      } catch {
        // Offline, DNS, CORS — indistinguishable here and all equally fatal.
        throw new ConverterUnavailableError();
      }
      if (!res.ok && res.status !== 206) throw new ConverterUnavailableError();
    })().catch((e) => {
      // Never cache a failure: the asset may appear, or the network may return.
      reachable = null;
      throw e;
    });
  }
  return reachable;
}

/** The standard pass's longest side: 1080p in either orientation. */
const STANDARD_LONG_EDGE = 1920;

/** Full-quality baseline H.264 + AAC re-encode: the first thing we try. */
export const DEFAULT_ENCODE_ARGS = [
  "-c:v",
  "libx264",
  "-profile:v",
  "baseline", // maximum device compatibility, including older iOS
  "-level",
  "4.0",
  "-pix_fmt",
  "yuv420p",
  "-preset",
  "veryfast",
  "-crf",
  "26",
  // At most 1080p (and even dimensions, which yuv420p requires). Single-threaded
  // wasm encodes a 4K clip at a crawl, or runs out of memory and falls through
  // to a lighter pass after minutes of wasted work; 1080p is plenty on a phone,
  // and the original is kept beside this copy.
  "-vf",
  longEdgeScaleFilter(STANDARD_LONG_EDGE),
  "-c:a",
  "aac",
  "-b:a",
  "128k",
  "-movflags",
  "+faststart",
];

type FFmpegInstance = {
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<void>;
  writeFile: (name: string, data: Uint8Array) => Promise<unknown>;
  readFile: (name: string) => Promise<unknown>;
  deleteFile: (name: string) => Promise<unknown>;
  exec: (args: string[]) => Promise<number>;
  on: (event: "progress", cb: (e: { progress: number }) => void) => void;
  terminate: () => void;
};

let loaded: Promise<FFmpegInstance> | null = null;

async function getFFmpeg(): Promise<FFmpegInstance> {
  if (!loaded) {
    loaded = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);
      const ff = new FFmpeg() as unknown as FFmpegInstance;
      // toBlobURL is given the MIME type explicitly, so what Storage sets as the
      // object's Content-Type does not matter — but the fetch it does underneath
      // is cross-origin, so the response does have to be CORS-readable.
      await ff.load({
        coreURL: await toBlobURL(coreUrl("ffmpeg-core.js"), "text/javascript"),
        wasmURL: await toBlobURL(coreUrl("ffmpeg-core.wasm"), "application/wasm"),
      });
      return ff;
    })().catch((e) => {
      loaded = null;
      throw e;
    });
  }
  return loaded;
}

/**
 * Re-encodes `file` to a widely playable H.264 + AAC .mp4.
 * Returns null when encoding isn't possible (too large, wasm unavailable,
 * encoder failure) so the caller can fall back to the original upload.
 */
export async function transcodeToH264Mp4(
  file: File,
  onProgress?: (ratio: number) => void,
  /** ffmpeg arguments between input and output; defaults to the full re-encode. */
  encodeArgs: string[] = DEFAULT_ENCODE_ARGS,
): Promise<Blob | null> {
  if (typeof window === "undefined") return null;
  if (file.size > MAX_TRANSCODE_BYTES) return null;

  const input = `in-${Date.now()}`;
  const output = `out-${Date.now()}.mp4`;
  try {
    const ff = await getFFmpeg();
    if (onProgress) ff.on("progress", (e) => onProgress(Math.max(0, Math.min(1, e.progress))));
    ff.writeFile && (await ff.writeFile(input, new Uint8Array(await file.arrayBuffer())));
    const code = await ff.exec(["-i", input, ...encodeArgs, output]);
    if (code !== 0) return null;
    const data = (await ff.readFile(output)) as Uint8Array;
    if (!data || data.byteLength === 0) return null;
    return new Blob([data.slice().buffer as ArrayBuffer], { type: "video/mp4" });
  } catch {
    return null;
  } finally {
    try {
      const ff = await getFFmpeg();
      await ff.deleteFile(input).catch(() => {});
      await ff.deleteFile(output).catch(() => {});
    } catch {
      /* nothing to clean up */
    }
  }
}

/**
 * Progressively cheaper conversion attempts.
 *
 * A single strict re-encode fails on plenty of real-world screen recordings
 * (odd frame rates, rotation metadata, exotic or broken audio tracks, or simply
 * running out of wasm memory on a big 4K capture). Each fallback drops another
 * demand so at least one pass produces a playable H.264 file.
 */
const FALLBACK_PASSES: { label: string; args: string[] }[] = [
  { label: "standard", args: DEFAULT_ENCODE_ARGS },
  {
    // Smaller frame + fixed frame rate: far less memory and CPU in wasm.
    label: "720p",
    args: [
      "-c:v",
      "libx264",
      "-profile:v",
      "baseline",
      "-level",
      "3.1",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "ultrafast",
      "-crf",
      "30",
      "-vf",
      "scale='min(1280,trunc(iw/2)*2)':-2",
      "-r",
      "30",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-movflags",
      "+faststart",
    ],
  },
  {
    // Silent copy: skips a broken or unsupported audio track entirely.
    label: "silent",
    args: [
      "-an",
      "-c:v",
      "libx264",
      "-profile:v",
      "baseline",
      "-level",
      "3.1",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "ultrafast",
      "-crf",
      "32",
      "-vf",
      "scale='min(960,trunc(iw/2)*2)':-2",
      "-r",
      "24",
      "-movflags",
      "+faststart",
    ],
  },
  {
    // Last resort: already-H.264 video in the wrong container just needs a remux.
    label: "remux",
    args: ["-c", "copy", "-movflags", "+faststart"],
  },
];

/** Each pass's own size ceiling (its longer edge), used when a plan limit is lower. */
const PASS_LONG_EDGE: Record<string, number> = {
  standard: STANDARD_LONG_EDGE,
  "720p": 1280,
  silent: 960,
};

/**
 * A scale filter that shrinks the longer edge to `maxLongEdge` (never enlarging),
 * keeping the aspect ratio and the even dimensions yuv420p needs.
 */
export function longEdgeScaleFilter(maxLongEdge: number): string {
  const n = Math.max(2, Math.floor(maxLongEdge / 2) * 2);
  return `scale=w='min(${n},iw)':h='min(${n},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
}

/**
 * The passes to try. With `maxLongEdge`, every re-encode is held to it and the
 * stream-copy remux is dropped, because a copy cannot change the picture size.
 */
export function conversionPasses(maxLongEdge?: number): { label: string; args: string[] }[] {
  if (!maxLongEdge) return FALLBACK_PASSES;
  return FALLBACK_PASSES.filter((p) => p.label !== "remux").map((p) => {
    const args = [...p.args];
    const vf = args.indexOf("-vf");
    if (vf >= 0) {
      args[vf + 1] = longEdgeScaleFilter(
        Math.min(maxLongEdge, PASS_LONG_EDGE[p.label] ?? Infinity),
      );
    }
    return { ...p, args };
  });
}

/**
 * Converts `file` to a widely playable .mp4, retrying with progressively
 * lighter settings. Returns null only when every pass fails, so callers can
 * show a clear fallback instead of a silent dead player.
 *
 * `maxLongEdge` caps the picture's longer side (the plan's max resolution).
 */
export async function convertToPlayableMp4(
  file: File,
  onProgress?: (ratio: number, label: string) => void,
  opts: { maxLongEdge?: number } = {},
): Promise<{ blob: Blob; pass: string } | null> {
  for (const pass of conversionPasses(opts.maxLongEdge)) {
    const blob = await transcodeToH264Mp4(file, (r) => onProgress?.(r, pass.label), pass.args);
    if (blob && blob.size > 0) return { blob, pass: pass.label };
  }
  return null;
}

/**
 * Output options that drop everything identifying from a clip: container and
 * stream tags (GPS position, device make and model, creation time, app and
 * encoder names), chapters, and any extra data track such as a phone's location
 * track. Only the first video and audio streams are kept. Rotation is not a tag,
 * so the picture still plays the right way up.
 */
export const PRIVACY_ARGS = [
  "-map",
  "0:v:0",
  "-map",
  "0:a:0?",
  "-map_metadata",
  "-1",
  "-map_chapters",
  "-1",
  "-fflags",
  "+bitexact",
  "-flags:v",
  "+bitexact",
  "-flags:a",
  "+bitexact",
];

const PRIVACY_PASSES: { label: string; args: string[] }[] = [
  // Fast and lossless: the picture and sound are copied, only the tags go.
  { label: "remux", args: [...PRIVACY_ARGS, "-c", "copy", "-movflags", "+faststart"] },
  // The container does not allow a straight copy (.avi, .mkv, odd codecs): re-encode.
  ...FALLBACK_PASSES.filter((p) => p.label !== "remux").map((p) => ({
    label: p.label,
    args: [...PRIVACY_ARGS, ...p.args],
  })),
];

/**
 * A copy of `file` with location and device information removed, as an .mp4.
 * Returns null when no pass could produce one, so callers can refuse the upload
 * rather than store the original with its metadata.
 */
export async function stripVideoMetadata(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<File | null> {
  for (const pass of PRIVACY_PASSES) {
    const blob = await transcodeToH264Mp4(file, onProgress, pass.args);
    if (blob && blob.size > 0) {
      const stem = file.name.replace(/\.[^.]+$/, "") || "clip";
      return new File([blob], `${stem}.mp4`, { type: "video/mp4" });
    }
  }
  return null;
}

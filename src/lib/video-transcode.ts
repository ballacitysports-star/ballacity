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

const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

/** Hard ceiling: encoding in wasm is slow, so skip absurdly large sources. */
export const MAX_TRANSCODE_BYTES = 200 * 1024 * 1024;

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
  // Even dimensions are required by yuv420p.
  "-vf",
  "scale=trunc(iw/2)*2:trunc(ih/2)*2",
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
      await ff.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
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
      "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.1",
      "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-crf", "30",
      "-vf", "scale='min(1280,trunc(iw/2)*2)':-2", "-r", "30",
      "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
    ],
  },
  {
    // Silent copy: skips a broken or unsupported audio track entirely.
    label: "silent",
    args: [
      "-an", "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.1",
      "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-crf", "32",
      "-vf", "scale='min(960,trunc(iw/2)*2)':-2", "-r", "24",
      "-movflags", "+faststart",
    ],
  },
  {
    // Last resort: already-H.264 video in the wrong container just needs a remux.
    label: "remux",
    args: ["-c", "copy", "-movflags", "+faststart"],
  },
];

/**
 * Converts `file` to a widely playable .mp4, retrying with progressively
 * lighter settings. Returns null only when every pass fails, so callers can
 * show a clear fallback instead of a silent dead player.
 */
export async function convertToPlayableMp4(
  file: File,
  onProgress?: (ratio: number, label: string) => void,
): Promise<{ blob: Blob; pass: string } | null> {
  for (const pass of FALLBACK_PASSES) {
    const blob = await transcodeToH264Mp4(file, (r) => onProgress?.(r, pass.label), pass.args);
    if (blob && blob.size > 0) return { blob, pass: pass.label };
  }
  return null;
}

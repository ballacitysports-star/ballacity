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
): Promise<Blob | null> {
  if (typeof window === "undefined") return null;
  if (file.size > MAX_TRANSCODE_BYTES) return null;

  const input = `in-${Date.now()}`;
  const output = `out-${Date.now()}.mp4`;
  try {
    const ff = await getFFmpeg();
    if (onProgress) ff.on("progress", (e) => onProgress(Math.max(0, Math.min(1, e.progress))));
    ff.writeFile && (await ff.writeFile(input, new Uint8Array(await file.arrayBuffer())));
    const code = await ff.exec([
      "-i",
      input,
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
      output,
    ]);
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

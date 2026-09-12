/**
 * Shared (client + server) upload rules for video and audio media.
 * Pure functions only — no Node or browser APIs.
 */

/** 200 MB — matches the `highlight-videos` bucket limit enforced by Storage. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export type VideoContainer = "mp4" | "webm" | "quicktime" | null;

export function videoExtension(name: string): string | null {
  return name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? null;
}

/**
 * The only gate a source clip has to pass to be accepted.
 *
 * There is deliberately no container or MIME allowlist here any more. One used to
 * live in this file and it was the reason uploads failed: a `.avi`, `.mkv`,
 * `.wmv` or `.3gp` was refused outright even though `convertToPlayableMp4` can
 * re-encode all of them, so the pipeline rejected precisely the files it was best
 * equipped to rescue. Worse, the two lists disagreed with the byte sniff below —
 * `mpeg`/`mpg` was on the allowlist but MPEG program streams start `00 00 01 BA`,
 * which `sniffVideoContainer` cannot match, so those uploads were accepted by the
 * client and then deleted by the server with a message contradicting the
 * allowlist that had just let them in.
 *
 * What replaces it is a stronger guarantee, enforced in the uploader: a clip is
 * accepted only once a widely playable H.264 copy of it exists. Format is
 * decided by reading the bytes (`needsPlaybackConversion`), never by trusting a
 * name or a client-supplied MIME type, and whatever will actually be served is
 * still sniffed server-side by `finalizeVideoUpload`.
 */
export function validateVideoSize(input: { bytes: number | null | undefined }): string | null {
  if (!input.bytes || input.bytes <= 0) return "The file is empty";
  if (input.bytes > MAX_VIDEO_BYTES) return "Video is too large (max 200 MB)";
  return null;
}

/**
 * Sniff the real container from magic bytes (defends against a faked MIME).
 *
 * Still the strict gate on anything a viewer can load. It does not need to learn
 * more containers: after conversion the served copy is always an MP4, and a clip
 * served without conversion has already been proved to be H.264 in an MP4 or
 * QuickTime wrapper. An exotic original kept only for download is finalized as
 * `kind: "source"`, which skips this check.
 */
export function sniffVideoContainer(bytes: Uint8Array): VideoContainer {
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "webm";
  }
  if (bytes.length >= 12) {
    const box = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
    if (box === "ftyp") {
      const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
      if (brand.startsWith("qt")) return "quicktime";
      return "mp4";
    }
  }
  return null;
}

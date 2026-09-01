/**
 * Shared (client + server) upload rules for video and audio media.
 * Pure functions only — no Node or browser APIs.
 */

export const ALLOWED_VIDEO_MIMES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "video/mpeg",
] as const;

export const ALLOWED_VIDEO_EXTENSIONS = ["mp4", "m4v", "mov", "webm", "mpeg", "mpg"] as const;

/** 200 MB — matches the `highlight-videos` bucket limit enforced by Storage. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export type VideoContainer = "mp4" | "webm" | "quicktime" | null;

export function isAllowedVideoMime(mime: string | null | undefined): boolean {
  return !!mime && (ALLOWED_VIDEO_MIMES as readonly string[]).includes(mime);
}

export function videoExtension(name: string): string | null {
  return name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? null;
}

export function isAllowedVideoExtension(name: string): boolean {
  const ext = videoExtension(name);
  return !!ext && (ALLOWED_VIDEO_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Human-friendly failure reason, or `null` when the file passes. Extension and
 * MIME are both checked because a client can claim either freely — the bytes
 * are re-sniffed server-side by `finalizeVideoUpload`.
 */
export function validateVideoMeta(input: {
  name: string;
  mime: string | null | undefined;
  bytes: number | null | undefined;
}): string | null {
  if (!input.bytes || input.bytes <= 0) return "The file is empty";
  if (input.bytes > MAX_VIDEO_BYTES) return "Video is too large (max 200 MB)";
  if (!isAllowedVideoExtension(input.name)) {
    return "Only MP4, MOV, M4V or WEBM videos are allowed";
  }
  // Some browsers report an empty type for .mov / .m4v — the extension and the
  // server-side byte sniff still gate those.
  if (input.mime && !isAllowedVideoMime(input.mime)) {
    return "Only MP4, MOV, M4V or WEBM videos are allowed";
  }
  return null;
}

/** Sniff the real container from magic bytes (defends against a faked MIME). */
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

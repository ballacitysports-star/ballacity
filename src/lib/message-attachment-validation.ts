import { sniffImageMime } from "@/lib/image-validation";
import { sniffVideoContainer } from "@/lib/video-validation";

/**
 * What a chat attachment may be, decided from the file's own bytes (never from
 * the name or the type the browser reports): a JPG, PNG or WEBP picture, an
 * MP4, QuickTime or WEBM video, or a PDF. Anything else is refused.
 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export const ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,application/pdf";

export type AttachmentKind = "image" | "video" | "pdf";
export type CheckedAttachment = { kind: AttachmentKind; mime: string };

const VIDEO_MIME = { mp4: "video/mp4", quicktime: "video/quicktime", webm: "video/webm" } as const;

export function classifyAttachment(bytes: Uint8Array): CheckedAttachment | null {
  const image = sniffImageMime(bytes);
  if (image) return { kind: "image", mime: image };
  const video = sniffVideoContainer(bytes);
  if (video) return { kind: "video", mime: VIDEO_MIME[video] };
  // "%PDF-" opens every PDF.
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return { kind: "pdf", mime: "application/pdf" };
  }
  return null;
}

/** Why a file is refused, or null when it passes. */
export function attachmentProblem(bytes: Uint8Array, size = bytes.byteLength): string | null {
  if (size > MAX_ATTACHMENT_BYTES) return "Attachment too large (max 20MB).";
  if (!classifyAttachment(bytes)) {
    return "That file type is not allowed. Send a photo (JPG, PNG, WEBP), a video (MP4, MOV, WEBM) or a PDF.";
  }
  return null;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH = new RegExp(`^(${UUID})/(${UUID})/[^/]+$`, "i");

/** `<conversation id>/<sender id>/<file>`: the only shape the upload code writes. */
export function parseAttachmentPath(
  path: string,
): { conversationId: string; senderId: string } | null {
  const m = PATH.exec(path);
  return m ? { conversationId: m[1]!.toLowerCase(), senderId: m[2]!.toLowerCase() } : null;
}

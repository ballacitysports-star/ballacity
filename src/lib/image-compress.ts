/**
 * Shrink a photo in the browser before it is uploaded as a message attachment.
 *
 * A phone camera produces 3–12 MB JPEGs, and a chat bubble shows them a few
 * hundred pixels wide. Uploading the original is what made sending a picture
 * sit on the progress bar, so the image is scaled to fit MAX_EDGE and
 * re-encoded here first, which leaves a small fraction of the bytes to send.
 *
 * Only JPEG and PNG are touched. Everything else — GIFs (which would lose
 * their animation), SVG, HEIC, video, documents — goes through unchanged, and
 * every failure returns the original file. Shrinking is an optimisation, never
 * a reason for a send to fail.
 */

/** Longest side, in pixels, of an uploaded photo. */
export const MAX_EDGE = 1920;
/** JPEG quality for re-encoded photos. */
export const JPEG_QUALITY = 0.8;
/** Files at or under this size are sent as they are. */
export const MIN_BYTES = 300 * 1024;

type OutputType = "image/jpeg" | "image/png";

export function isCompressibleImage(file: Pick<File, "type">): boolean {
  return file.type === "image/jpeg" || file.type === "image/png";
}

/** Dimensions that fit inside `maxEdge` on the longest side. Never enlarges. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** `IMG_01.png` → `IMG_01.jpg` when the format changed; unchanged otherwise. */
export function renameForType(name: string, from: string, to: OutputType): string {
  if (from === to) return name;
  const ext = to === "image/jpeg" ? "jpg" : "png";
  const stem = name.replace(/\.[^./\\]+$/, "");
  return `${stem || "image"}.${ext}`;
}

function hasTransparency(pixels: Uint8ClampedArray): boolean {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i]! < 255) return true;
  }
  return false;
}

function toBlob(canvas: HTMLCanvasElement, type: OutputType, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * The file to upload in place of `file`: a downscaled, re-encoded copy when
 * that is meaningfully smaller, otherwise `file` itself.
 */
export async function compressImageForUpload(file: File): Promise<File> {
  if (!isCompressibleImage(file) || file.size <= MIN_BYTES) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

  let bitmap: ImageBitmap | null = null;
  try {
    // Bake the camera's EXIF rotation into the pixels. The re-encoded file
    // carries no EXIF, so without this a portrait photo would arrive sideways.
    // An engine that does not understand the option throws, which lands in
    // the catch below and sends the original instead.
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as ImageBitmapOptions);

    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    // A PNG becomes a JPEG (far smaller for screenshots and photos) unless it
    // actually uses transparency, which a JPEG would flatten to black.
    let type: OutputType = "image/jpeg";
    if (file.type === "image/png" && hasTransparency(ctx.getImageData(0, 0, width, height).data)) {
      type = "image/png";
    }

    const blob = await toBlob(canvas, type, type === "image/jpeg" ? JPEG_QUALITY : undefined);
    // An engine that cannot encode the requested type hands back another one.
    if (!blob || blob.type !== type || blob.size >= file.size) return file;

    return new File([blob], renameForType(file.name, file.type, type), {
      type,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}

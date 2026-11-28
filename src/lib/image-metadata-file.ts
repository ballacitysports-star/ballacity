import { isAllowedImageMime, sniffImageMime } from "@/lib/image-validation";
import { METADATA_IMAGE_REFUSAL } from "@/lib/image-upload-errors";

/**
 * Browser-side G3 for uploads that have no server step: the picture's bytes go straight from the device to Storage
 * or into a table, so the location and camera tags must come off here, before the upload. The server-side strip in
 * finalizeImageUpload and finalizeMessageAttachment stays the authority where it exists; this only covers the paths
 * without one, and a member who calls the Storage API directly can still skip it (see the G3 row of
 * docs/release/privacy-gap-register.md).
 *
 * The helpers return null for a file that is not a JPEG, PNG or WEBP or cannot be parsed. Callers refuse the upload
 * then: there is no fallback that sends the original.
 *
 * The stripper is loaded on first use, so it stays out of the bundle every page loads first.
 */

async function readBytes(file: Blob): Promise<Uint8Array> {
  // Blob.arrayBuffer where it exists; FileReader for an older browser or test DOM without it.
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsArrayBuffer(file);
  });
}

/** The stripped bytes and their real type, or null when the file cannot be cleaned. */
export async function strippedImageBytes(
  file: Blob,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  let bytes: Uint8Array;
  try {
    bytes = await readBytes(file);
  } catch {
    return null;
  }
  const mime = sniffImageMime(bytes);
  if (!mime) return null;
  const { tryStripImageMetadata } = await import("@/lib/image-metadata");
  const result = tryStripImageMetadata(bytes);
  return result.ok ? { bytes: result.bytes, mime } : null;
}

/** `file` without its metadata, keeping its name; the type is the one the bytes really have. */
export async function stripImageFile(file: File): Promise<File | null> {
  const clean = await strippedImageBytes(file);
  if (!clean) return null;
  return new File([clean.bytes as BlobPart], file.name, {
    type: clean.mime,
    lastModified: file.lastModified,
  });
}

/** stripImageFile for a caller that refuses the upload with our own sentence when the file cannot be cleaned. */
export async function requireStrippedImageFile(file: File): Promise<File> {
  const clean = await stripImageFile(file);
  if (!clean) throw new Error(METADATA_IMAGE_REFUSAL);
  return clean;
}

/** A `data:` URL of the stripped picture, for the places that store a picture inline in a row. */
export async function strippedImageDataUrl(file: Blob): Promise<string | null> {
  const clean = await strippedImageBytes(file);
  if (!clean) return null;
  const { bytesToBase64 } = await import("@/lib/inline-image-metadata");
  return `data:${clean.mime};base64,${bytesToBase64(clean.bytes)}`;
}

/** A staff photo as the edit screens store it (a stripped data URL), or the sentence to show when it is refused. */
export async function staffAvatarDataUrl(
  file: File,
): Promise<{ dataUrl: string } | { error: string }> {
  if (!isAllowedImageMime(file.type)) return { error: "Only JPG, PNG or WEBP images are allowed" };
  const dataUrl = await strippedImageDataUrl(file);
  return dataUrl ? { dataUrl } : { error: METADATA_IMAGE_REFUSAL };
}

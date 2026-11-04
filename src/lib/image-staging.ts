/**
 * Private staging for image uploads. The browser writes the original here; only the server can read it, clean it and promote the clean
 * bytes to the destination bucket. See docs/privacy/g3b-image-staging.md.
 */
export const IMAGE_STAGING_BUCKET = "image-staging";

export function extForImageMime(mime: string): "jpg" | "png" | "webp" | null {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return null;
}

/** `{userId}/{uuid}.{ext}`: the only shape the staging policy lets a user write. */
export function stagingPathFor(userId: string, id: string, ext: string): string {
  return `${userId}/${id}.${ext}`;
}

/** A path that is exactly `{userId}/{file}` with a plain file name (no traversal, no nesting of other folders). */
export function isOwnFilePath(userId: string, path: string): boolean {
  if (!path.startsWith(`${userId}/`)) return false;
  const rest = path.slice(userId.length + 1);
  return /^[A-Za-z0-9._-]{1,120}$/.test(rest) && !rest.includes("..");
}

export function isMissingBucketError(message: string | undefined | null): boolean {
  return /bucket not found|not found/i.test(message ?? "");
}

import { supabase } from "@/integrations/supabase/client";
import { buildMediaRef } from "@/lib/media-refs";
import { warmImageVariants } from "@/lib/image-variants";
import { finalizeImageUpload } from "@/lib/image-uploads.functions";
import { refreshBlockedImages } from "@/lib/blocked-images";
import {
  MAX_IMAGE_BYTES,
  isAllowedImageMime,
  readImageDimensions,
  validateImageMeta,
} from "@/lib/image-validation";

export type PublicImageBucket =
  | "avatars"
  | "covers"
  | "trainer-avatars"
  | "team-avatars"
  | "team-covers"
  | "org-avatars"
  | "org-covers";

export type PrivateImageBucket = "game-covers";

export type ImageBucket = PublicImageBucket | PrivateImageBucket;

const PRIVATE_BUCKETS: Record<PrivateImageBucket, true> = {
  "game-covers": true,
};

function decodeDataUrl(dataUrl: string): { blob: Blob; mime: string; ext: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) throw new Error("Not a valid image data URL");
  const mime = match[1];
  if (!isAllowedImageMime(mime)) throw new Error("Only JPG, PNG or WEBP images are allowed");
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Image is too large (max 8 MB)");

  const failure = validateImageMeta({
    mime,
    bytes: bytes.byteLength,
    dimensions: readImageDimensions(bytes),
  });
  if (failure) throw new Error(failure);

  const blob = new Blob([bytes], { type: mime });
  return { blob, mime, ext };
}

/**
 * Upload a data URL (jpeg/png/webp) to a Supabase Storage bucket under
 * `{ownerId}/{uuid}.{ext}` and return a URL suitable for use in `<img src>`.
 *
 * Public buckets get a stable `getPublicUrl`; private buckets get a
 * `storage://bucket/path` reference that display code signs per viewer. `ownerId` MUST match the first path segment enforced by storage
 * RLS — `auth.uid()` for user buckets or the entity id for team/org buckets.
 */
export async function uploadDataUrlToBucket(
  bucket: ImageBucket,
  ownerId: string,
  dataUrl: string,
): Promise<string> {
  const { blob, mime, ext } = decodeDataUrl(dataUrl);
  const path = `${ownerId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType: mime,
    upsert: false,
    cacheControl: "31536000",
  });
  if (error) throw new Error(error.message);

  // Server-side re-validation + automated safety scan. Anything unsafe is
  // quarantined (hidden app-wide) and never handed back as a usable URL.
  const check = await finalizeImageUpload({ data: { bucket, path } });
  if (check?.quarantined) {
    void refreshBlockedImages();
    throw new Error("This image was flagged by our automated safety check and is pending review.");
  }

  if ((PRIVATE_BUCKETS as Record<string, true>)[bucket]) {
    // Private media is persisted as a bucket+path reference, never as a signed
    // URL: display code mints a fresh one-hour URL per viewer so Storage RLS is
    // re-checked on every view instead of a token outliving permissions.
    return buildMediaRef(bucket, path);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  warmImageVariants(data.publicUrl);
  return data.publicUrl;
}

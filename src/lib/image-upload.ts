import { supabase } from "@/integrations/supabase/client";
import { buildMediaRef } from "@/lib/media-refs";
import { warmImageVariants } from "@/lib/image-variants";
import { promoteStagedImageUpload } from "@/lib/image-uploads.functions";
import { IMAGE_STAGING_BUCKET, isMissingBucketError } from "@/lib/image-staging";
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

  // Stage privately; the server cleans, scans and only then publishes. There is deliberately NO fallback to an upload straight into
  // the destination bucket: if staging is unavailable the upload fails (an unprocessed original must never be public).
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sign in to upload images.");
  if (ownerId !== auth.user.id) {
    throw new Error("Images can only be uploaded to your own folder.");
  }
  const stagingPath = `${ownerId}/${crypto.randomUUID()}.${ext}`;
  const { error: stageErr } = await supabase.storage
    .from(IMAGE_STAGING_BUCKET)
    .upload(stagingPath, blob, {
      contentType: mime,
      upsert: false,
    });
  if (stageErr) {
    throw new Error(
      isMissingBucketError(stageErr.message)
        ? "Image uploads are temporarily unavailable. Please try again later."
        : stageErr.message,
    );
  }
  const check = await promoteStagedImageUpload({ data: { bucket, stagingPath, targetPath: path } });
  if (check?.held) {
    throw new Error("We couldn't check this image right now. Please try again in a few minutes.");
  }
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

import { supabase } from "@/integrations/supabase/client";
import { warmImageVariants } from "@/lib/image-variants";

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

// 10 years — effectively permanent for <img src> in private buckets.
const SIGNED_URL_TTL = 60 * 60 * 24 * 365 * 10;

function decodeDataUrl(dataUrl: string): { blob: Blob; mime: string; ext: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) throw new Error("Not a valid image data URL");
  const mime = match[1];
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime });
  if (blob.size > 8 * 1024 * 1024) throw new Error("Image is too large (max 8 MB)");
  return { blob, mime, ext };
}

/**
 * Upload a data URL (jpeg/png/webp) to a Supabase Storage bucket under
 * `{ownerId}/{uuid}.{ext}` and return a URL suitable for use in `<img src>`.
 *
 * Public buckets get a stable `getPublicUrl`; private buckets get a long-lived
 * signed URL. `ownerId` MUST match the first path segment enforced by storage
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

  if ((PRIVATE_BUCKETS as Record<string, true>)[bucket]) {
    const { data, error: sErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_TTL);
    if (sErr || !data?.signedUrl) {
      throw new Error(sErr?.message ?? "Could not build a signed URL");
    }
    // Pre-render thumbnails / responsive sizes on the server so the first view
    // is already cached.
    warmImageVariants(data.signedUrl);
    return data.signedUrl;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  warmImageVariants(data.publicUrl);
  return data.publicUrl;
}

import { supabase } from "@/integrations/supabase/client";

export type ImageBucket =
  | "avatars"
  | "covers"
  | "trainer-avatars"
  | "team-avatars"
  | "team-covers"
  | "org-avatars"
  | "org-covers";

/**
 * Upload a data URL (jpeg/png/webp) to a public bucket under
 * `{ownerId}/{uuid}.{ext}` and return its public URL.
 *
 * `ownerId` MUST match the first path segment enforced by storage RLS —
 * `auth.uid()` for user buckets or the entity id for team/org buckets.
 */
export async function uploadDataUrlToBucket(
  bucket: ImageBucket,
  ownerId: string,
  dataUrl: string,
): Promise<string> {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) throw new Error("Not a valid image data URL");
  const mime = match[1];
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime });
  if (blob.size > 8 * 1024 * 1024) throw new Error("Image is too large (max 8 MB)");

  const path = `${ownerId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType: mime,
    upsert: false,
    cacheControl: "31536000",
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

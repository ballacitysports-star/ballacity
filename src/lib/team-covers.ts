import { supabase } from "@/integrations/supabase/client";
import { isAllowedImageMime } from "@/lib/image-validation";

const ALLOWED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

const BUCKET = "team-covers";
const MAX_BYTES = 4 * 1024 * 1024;

export type UploadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

export type UploadTeamCoverResult = {
  path: string;
  url: string;
};

export class TeamCoverUploadError extends Error {}

function extFromFile(file: File): string {
  const fromName = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  const fromType = file.type.split("/")[1];
  return fromType || "jpg";
}

/**
 * Upload a team cover image to Supabase Storage using a signed upload URL,
 * with real byte-level progress via XHR. `team-covers` is a public branding
 * bucket, so the stable public URL is returned — no bearer token is minted.
 */
export async function uploadTeamCover(
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<UploadTeamCoverResult> {
  if (!ALLOWED_IMAGE_EXTENSIONS.includes(extFromFile(file))) {
    throw new TeamCoverUploadError("Please choose a JPG, PNG or WEBP image.");
  }
  if (file.type && !isAllowedImageMime(file.type)) {
    throw new TeamCoverUploadError("Please choose a JPG, PNG or WEBP image.");
  }
  if (file.size > MAX_BYTES) {
    throw new TeamCoverUploadError("Image is too large — max 4 MB.");
  }

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    throw new TeamCoverUploadError("You need to be signed in to upload a photo.");
  }
  const userId = userRes.user.id;

  const ext = extFromFile(file);
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { data: signed, error: signedErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (signedErr || !signed) {
    throw new TeamCoverUploadError(signedErr?.message || "Could not start upload.");
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signed.signedUrl, true);
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => {
      if (!onProgress) return;
      const total = e.lengthComputable ? e.total : file.size;
      const loaded = e.loaded;
      onProgress({
        loaded,
        total,
        percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
      });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
        resolve();
      } else {
        reject(new TeamCoverUploadError(`Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new TeamCoverUploadError("Network error during upload."));
    xhr.onabort = () => reject(new TeamCoverUploadError("Upload was cancelled."));
    xhr.send(file);
  });

  const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!publicUrl?.publicUrl) {
    throw new TeamCoverUploadError("Uploaded, but could not build a display URL.");
  }

  return { path, url: publicUrl.publicUrl };
}

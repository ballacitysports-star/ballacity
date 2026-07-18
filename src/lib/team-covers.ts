import { supabase } from "@/integrations/supabase/client";

const BUCKET = "team-covers";
// 10 years — effectively permanent for display in <img src>.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 10;
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
 * with real byte-level progress via XHR. Returns a long-lived signed URL
 * suitable for use in <img src>.
 */
export async function uploadTeamCover(
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<UploadTeamCoverResult> {
  if (!file.type.startsWith("image/")) {
    throw new TeamCoverUploadError("Please choose an image file.");
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

  const { data: signedGet, error: signedGetErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedGetErr || !signedGet?.signedUrl) {
    throw new TeamCoverUploadError(
      signedGetErr?.message || "Uploaded, but could not build a display URL.",
    );
  }

  return { path, url: signedGet.signedUrl };
}

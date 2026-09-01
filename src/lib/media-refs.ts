/**
 * Canonical references to Storage objects.
 *
 * Private media (game covers, highlight clips, chat attachments, payment
 * proofs) must never be persisted as a long-lived signed URL: the token in
 * such a URL is a bearer credential that outlives every permission change.
 * Instead we persist a bucket + path reference (`storage://bucket/path`) and
 * mint a short-lived signed URL at render time, so access is re-checked
 * against Storage RLS on every view.
 *
 * Pure functions only — safe on both client and server.
 */

export const PRIVATE_MEDIA_BUCKETS = [
  "game-covers",
  "highlight-videos",
  "message-attachments",
  "payment-proofs",
] as const;

export type PrivateMediaBucket = (typeof PRIVATE_MEDIA_BUCKETS)[number];

export const MEDIA_REF_SCHEME = "storage://";

/** Short-lived signing window used for every private media URL. */
export const MEDIA_SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export function isPrivateMediaBucket(bucket: string): bucket is PrivateMediaBucket {
  return (PRIVATE_MEDIA_BUCKETS as readonly string[]).includes(bucket);
}

export function buildMediaRef(bucket: string, path: string): string {
  return `${MEDIA_REF_SCHEME}${bucket}/${path.replace(/^\/+/, "")}`;
}

export function isMediaRef(value: string | null | undefined): boolean {
  return !!value && value.startsWith(MEDIA_REF_SCHEME);
}

export type ParsedMediaRef = { bucket: string; path: string };

export function parseMediaRef(value: string | null | undefined): ParsedMediaRef | null {
  if (!isMediaRef(value)) return null;
  const rest = value!.slice(MEDIA_REF_SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) };
}

/**
 * Recognise legacy values that already live in the database: signed Storage
 * URLs (`/storage/v1/object/sign/<bucket>/<path>?token=…`) minted before we
 * switched to refs. Treating them as refs means the stale token is dropped and
 * a fresh, permission-checked one is used instead.
 */
export function parseStorageMediaUrl(value: string | null | undefined): ParsedMediaRef | null {
  if (!value || !value.includes("/storage/v1/object/")) return null;
  let pathname: string;
  try {
    pathname = new URL(value, "http://localhost").pathname;
  } catch {
    return null;
  }
  const marker = pathname.includes("/storage/v1/object/sign/")
    ? "/storage/v1/object/sign/"
    : pathname.includes("/storage/v1/object/public/")
      ? "/storage/v1/object/public/"
      : null;
  if (!marker) return null;
  const rest = pathname.slice(pathname.indexOf(marker) + marker.length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { bucket: rest.slice(0, slash), path: decodeURIComponent(rest.slice(slash + 1)) };
}

/**
 * Normalise any stored media value into "needs signing" (private bucket) or
 * "use as-is" (public bucket URL, bundled asset, remote image).
 */
export function resolvableMediaRef(value: string | null | undefined): ParsedMediaRef | null {
  const ref = parseMediaRef(value) ?? parseStorageMediaUrl(value);
  if (!ref) return null;
  return isPrivateMediaBucket(ref.bucket) ? ref : null;
}

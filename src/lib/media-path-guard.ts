/**
 * Ownership guard for private storage paths.
 *
 * Service-role code signs and downloads storage objects with RLS bypassed, so
 * every path that originated from user-writable data must be proven to live in
 * its owner's own folder first. Storage layout is always `<user_id>/<file>`.
 *
 * A database trigger (`enforce_reel_media_ownership_trg`) enforces the same rule
 * on write; this is the read-side half of the defense.
 */

/** True when `path` is empty (nothing to sign) or lives in the user's folder. */
export function isOwnedMediaPath(userId: string, path: string | null | undefined): boolean {
  if (path === null || path === undefined || path === "") return true;
  if (!userId) return false;
  if (typeof path !== "string") return false;
  const segments = path.split("/");
  if (segments.some((s) => s === ".." || s === "")) return false;
  return segments[0] === userId;
}

/** Throws when `path` is non-empty and does not belong to `userId`. */
export function assertOwnedMediaPath(userId: string, path: string | null | undefined): void {
  if (!isOwnedMediaPath(userId, path)) {
    throw new Error("MEDIA_PATH_FORBIDDEN: that media file does not belong to this account");
  }
}

/**
 * Returns the path when it is owned, otherwise null — for read paths that
 * should degrade gracefully (a missing thumbnail) instead of failing the page.
 */
export function ownedMediaPathOrNull(
  userId: string,
  path: string | null | undefined,
): string | null {
  if (path === null || path === undefined || path === "") return null;
  return isOwnedMediaPath(userId, path) ? path : null;
}

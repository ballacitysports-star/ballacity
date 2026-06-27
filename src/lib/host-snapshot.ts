/**
 * Builds the host snapshot stored on a freshly created game.
 *
 * Resolution priority for `name`:
 *   1. `profiles.display_name` from the database (freshest source of truth)
 *   2. `user_metadata.display_name` / `full_name` / `name` (already preferred
 *      by `defaultsFromUser` in `user-prefs-store`, exposed via `fallback.name`)
 *   3. `email` local-part fallback (only as a last resort)
 *
 * This helper is intentionally pure so it can be unit-tested with a stubbed
 * `fetchDbProfile` that simulates slow profile loading.
 */

export type HostSnapshotInput = {
  userId: string;
  userEmail?: string | null;
  /** In-memory profile (from `useMyProfile`) — may still be a fallback while DB loads. */
  fallback?: {
    name?: string;
    username?: string;
    avatar?: string;
    rating?: number;
  } | null;
  fetchDbProfile: (userId: string) => Promise<{
    display_name?: string | null;
    username?: string | null;
    avatar_initials?: string | null;
    avatar_url?: string | null;
  } | null>;
};

export type HostSnapshot = {
  name: string;
  username: string;
  avatar: string;
  rating?: number;
};

export async function resolveHostSnapshot(input: HostSnapshotInput): Promise<HostSnapshot> {
  const db = await safeFetch(input);

  const emailLocal = input.userEmail ? input.userEmail.split("@")[0] : undefined;
  const fallbackName = input.fallback?.name;
  // Treat the email local-part as the least trustworthy source.
  const fallbackIsEmailPrefix = !!emailLocal && fallbackName === emailLocal;

  const name =
    db?.display_name ||
    (fallbackName && !fallbackIsEmailPrefix ? fallbackName : undefined) ||
    emailLocal ||
    "Player";

  const usernameRaw = db?.username || stripLeadingAt(input.fallback?.username) || emailLocal || input.userId.slice(0, 6);
  const username = `@${stripLeadingAt(usernameRaw) ?? ""}`;

  const avatar = db?.avatar_initials || input.fallback?.avatar || initialsFrom(name);

  return { name, username, avatar, rating: input.fallback?.rating };
}

async function safeFetch(input: HostSnapshotInput) {
  try {
    return await input.fetchDbProfile(input.userId);
  } catch {
    return null;
  }
}

function stripLeadingAt(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/^@/, "");
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (letters || name.slice(0, 2) || "P").toUpperCase();
}

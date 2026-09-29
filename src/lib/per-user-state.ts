/**
 * Client state that belongs to whoever is signed in, not to the device.
 *
 * These keys are read by stores that are not keyed on the user id, so after a
 * switch of identity — signing out on a shared device, or a guardian switching
 * into a managed child's profile and back — the next person would briefly see
 * the previous one's cached games or replay their pending signup answers. Each
 * store re-hydrates from the database on the next page load.
 *
 * `openrun.blockedUsers.v1` is deliberately absent: it is already keyed by
 * host id, and it is the host's only copy of their block list, so clearing it
 * would destroy data rather than reset a cache.
 */
export const PER_USER_STORAGE_KEYS = [
  "openrun.joinedGameIds.v1",
  "openrun.hostedGames.v1",
  "openrun:pending-dob",
  "openrun:pending-legal-consent",
] as const;

export async function resetPerUserClientState(): Promise<void> {
  if (typeof window === "undefined") return;
  for (const key of PER_USER_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
  // Signed media URLs are per-viewer credentials.
  try {
    const { clearMediaUrlCache } = await import("@/hooks/use-media-url");
    clearMediaUrlCache();
  } catch {
    /* ignore */
  }
}

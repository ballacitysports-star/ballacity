/**
 * Client state that belongs to whoever is signed in, not to the device.
 *
 * These keys are read by stores that are not keyed on the user id, so after a
 * switch of identity — signing out on a shared device, or a guardian switching
 * into a managed child's profile and back — the next person would briefly see
 * the previous one's cached games or replay their pending signup answers. Each
 * store re-hydrates from the database on the next page load.
 *
 * `openrun.blockedUsers.v1` is deliberately absent. Nothing reads it any more (a
 * host's Block now records an account block in the database), but it is the only
 * record on that device of who a host once blocked, so it is left alone rather
 * than deleted or silently turned into real blocks.
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

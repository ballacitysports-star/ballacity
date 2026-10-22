import type { ProfileVisibility } from "@/lib/privacy";

/**
 * Hiding a profile is the existing "Only me" visibility, which the database
 * already enforces. These helpers add the quick Hide / Show on top of it.
 */

/** A profile is hidden when only its owner can open it. */
export function isProfileHidden(visibility: ProfileVisibility): boolean {
  return visibility === "private";
}

/**
 * What Show restores: the setting the member had before hiding. Anything
 * unknown becomes Everyone, and Show never lands back on "Only me".
 */
export function visibilityAfterShow(
  remembered: string | null | undefined,
): Exclude<ProfileVisibility, "private"> {
  return remembered === "members" ? "members" : "public";
}

const storageKey = (userId: string) => `ballacity.visibility-before-hide.${userId}`;

/** Remember the setting in force before hiding, so Show can put it back. Best effort. */
export function rememberVisibility(userId: string, visibility: ProfileVisibility): void {
  if (visibility === "private") return;
  try {
    window.localStorage.setItem(storageKey(userId), visibility);
  } catch {
    /* storage unavailable: Show falls back to Everyone */
  }
}

export function readRememberedVisibility(userId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

export function clearRememberedVisibility(userId: string): void {
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    /* storage unavailable */
  }
}

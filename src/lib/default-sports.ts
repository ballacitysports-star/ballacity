import { useEffect, useRef } from "react";
import { useMyProfileState } from "@/lib/user-prefs-store";

/**
 * The viewer's favorite sports, straight from their profile.
 *
 * `loaded` mirrors the profile row load so callers never seed a filter or
 * form from the auth-derived fallback (which has no sports at all).
 */
export function useDefaultSports(): { sports: string[]; loaded: boolean } {
  const { profile, loaded } = useMyProfileState();
  return {
    sports: (profile?.sports ?? []).map((s) => s.name as string).filter(Boolean),
    loaded,
  };
}

const SEED_PREFIX = "openrun:sport-seeded.";

function alreadySeeded(key: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SEED_PREFIX + key) === "1";
  } catch {
    return true;
  }
}

function markSeeded(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEED_PREFIX + key, "1");
  } catch {
    /* ignore */
  }
}

/**
 * One-time seeding of a screen's sport filter from the viewer's profile.
 *
 * Fires at most once per browser per `key`, and only while the screen has no
 * selection of its own — so an explicit "All sports" always sticks afterwards.
 */
export function useSeedSportsOnce(
  key: string,
  {
    ready,
    hasSelection,
    apply,
  }: { ready: boolean; hasSelection: boolean; apply: (sports: string[]) => void },
) {
  const { sports, loaded } = useDefaultSports();
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;
    if (!ready || !loaded) return;
    doneRef.current = true;
    if (alreadySeeded(key)) return;
    markSeeded(key);
    if (hasSelection || sports.length === 0) return;
    apply(sports);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, loaded, key]);
}

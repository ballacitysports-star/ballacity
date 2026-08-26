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

const OVERRIDE_PREFIX = "openrun:sport-choice.";

/**
 * Remember that the viewer picked the sport filter themselves on a screen.
 * From then on their choice — including "All sports" — always wins.
 */
export function markSportChoice(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OVERRIDE_PREFIX + key, "1");
  } catch {
    /* ignore */
  }
}

export function hasSportChoice(key: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(OVERRIDE_PREFIX + key) === "1";
  } catch {
    return true;
  }
}

const sameSports = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Keep a screen's sport filter defaulted to the viewer's profile sports until
 * they choose for themselves (tracked via `markSportChoice`).
 *
 * Unlike a one-shot seed, this re-applies when the profile loads late or the
 * viewer edits their favorite sports.
 */
export function useProfileSportDefault(
  key: string,
  {
    ready,
    current,
    apply,
  }: { ready: boolean; current: string[]; apply: (sports: string[]) => void },
) {
  const { sports, loaded } = useDefaultSports();
  const lastAppliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !loaded) return;
    if (sports.length === 0) return;
    if (hasSportChoice(key)) return;
    const signature = sports.join("|");
    if (lastAppliedRef.current === signature) return;
    if (sameSports(current, sports)) {
      lastAppliedRef.current = signature;
      return;
    }
    lastAppliedRef.current = signature;
    apply(sports);
    // `current`/`apply` intentionally read at effect time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, loaded, key, sports.join("|")]);
}

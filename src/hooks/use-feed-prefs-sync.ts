import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getFeedPreferences, saveFeedPreferences } from "@/lib/feed-prefs.functions";
import {
  normalizeFeedPrefs,
  setFeedPrefs,
  useFeedPrefs,
  type FeedPrefs,
} from "@/lib/user-prefs-store";

/**
 * Keeps feed preferences in sync with the signed-in user's account row.
 * localStorage stays the source of truth for rendering (and the only store for
 * signed-out visitors); on sign-in we pull the remote copy, then mirror any
 * later local change back with a short debounce.
 */
export function useFeedPrefsSync() {
  const { user } = useAuth();
  const prefs = useFeedPrefs();
  const load = useServerFn(getFeedPreferences);
  const save = useServerFn(saveFeedPreferences);

  const loadedFor = useRef<string | null>(null);
  const lastSynced = useRef<string>("");
  const json = JSON.stringify(prefs);

  useEffect(() => {
    if (!user?.id) {
      loadedFor.current = null;
      lastSynced.current = "";
      return;
    }
    if (loadedFor.current === user.id) return;
    loadedFor.current = user.id;
    let cancelled = false;

    void load()
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          // First device for this account: adopt whatever is stored locally.
          lastSynced.current = json;
          void save({ data: { prefsJson: json } }).catch(() => {});
          return;
        }
        const remote = normalizeFeedPrefs(JSON.parse(row.prefsJson)) as FeedPrefs;
        lastSynced.current = JSON.stringify(remote);
        setFeedPrefs(remote);
      })
      .catch(() => {
        // Offline or transient failure: keep using the local copy.
        loadedFor.current = null;
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || loadedFor.current !== user.id) return;
    if (!lastSynced.current || json === lastSynced.current) return;
    const t = setTimeout(() => {
      lastSynced.current = json;
      void save({ data: { prefsJson: json } }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [json, user?.id]);
}

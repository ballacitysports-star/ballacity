import { useCallback, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
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
  const { user, session, loading } = useAuth();
  const prefs = useFeedPrefs();
  const load = useServerFn(getFeedPreferences);
  const save = useServerFn(saveFeedPreferences);

  const loadedFor = useRef<string | null>(null);
  const lastSynced = useRef<string>("");
  const json = JSON.stringify(prefs);

  const getLiveAccessToken = useCallback(
    async (expectedUserId: string) => {
      if (session?.access_token && session.user?.id === expectedUserId) {
        return session.access_token;
      }
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token && data.session.user?.id === expectedUserId) {
        return data.session.access_token;
      }
      return null;
    },
    [session?.access_token, session?.user?.id],
  );

  useEffect(() => {
    if (loading) return;
    if (!user?.id) {
      loadedFor.current = null;
      lastSynced.current = "";
      return;
    }
    if (loadedFor.current === user.id) return;
    loadedFor.current = user.id;
    let cancelled = false;

    void getLiveAccessToken(user.id)
      .then((token) => {
        if (cancelled || !token) return undefined;
        return load({ headers: { Authorization: `Bearer ${token}` } });
      })
      .then((row) => {
        if (cancelled) return;
        if (row === undefined) {
          loadedFor.current = null;
          return;
        }
        if (!row) {
          // First device for this account: adopt whatever is stored locally.
          lastSynced.current = json;
          void getLiveAccessToken(user.id)
            .then((token) => {
              if (!token) return null;
              return save({
                data: { prefsJson: json },
                headers: { Authorization: `Bearer ${token}` },
              });
            })
            .catch(() => {});
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
  }, [getLiveAccessToken, json, load, loading, save, user?.id]);

  useEffect(() => {
    if (loading || !user?.id || loadedFor.current !== user.id) return;
    if (!lastSynced.current || json === lastSynced.current) return;
    const t = setTimeout(() => {
      lastSynced.current = json;
      void getLiveAccessToken(user.id)
        .then((token) => {
          if (!token) return null;
          return save({
            data: { prefsJson: json },
            headers: { Authorization: `Bearer ${token}` },
          });
        })
        .catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [getLiveAccessToken, json, loading, save, user?.id]);
}

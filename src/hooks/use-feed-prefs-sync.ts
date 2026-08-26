import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
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

  const readRemotePrefs = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("feed_preferences")
      .select("prefs, saved_views, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      prefsJson: JSON.stringify({
        ...((data.prefs ?? {}) as Record<string, unknown>),
        savedViews: data.saved_views ?? [],
      }),
      updatedAt: String(data.updated_at),
    };
  }, []);

  const writeRemotePrefs = useCallback(async (userId: string, prefsJson: string) => {
    const parsed = JSON.parse(prefsJson) as Record<string, unknown>;
    const savedViews = Array.isArray(parsed.savedViews) ? parsed.savedViews : [];
    delete parsed.savedViews;

    const { error } = await supabase.from("feed_preferences").upsert(
      {
        user_id: userId,
        prefs: parsed as Json,
        saved_views: savedViews as Json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (error) throw error;
    return { ok: true };
  }, []);

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
        return readRemotePrefs(user.id);
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
              return writeRemotePrefs(user.id, json);
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
  }, [getLiveAccessToken, json, loading, readRemotePrefs, user?.id, writeRemotePrefs]);

  useEffect(() => {
    if (loading || !user?.id || loadedFor.current !== user.id) return;
    if (!lastSynced.current || json === lastSynced.current) return;
    const t = setTimeout(() => {
      lastSynced.current = json;
      void getLiveAccessToken(user.id)
        .then((token) => {
          if (!token) return null;
          return writeRemotePrefs(user.id, json);
        })
        .catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [getLiveAccessToken, json, loading, user?.id, writeRemotePrefs]);
}

import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to highlight_reels changes and run `onChange` (debounced) whenever a
 * reel is created, finishes processing, or is hidden/deleted. Used so freshly
 * uploaded reels appear in the public feed and on profiles without a refresh.
 */
export function useReelRealtime(
  onChange: () => void,
  opts?: { userId?: string | null; enabled?: boolean },
) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const userId = opts?.userId ?? null;
  const enabled = opts?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), 400);
    };

    const channel = supabase
      .channel(`reel-realtime-${userId ?? "all"}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "highlight_reels",
          ...(userId ? { filter: `user_id=eq.${userId}` } : {}),
        },
        fire,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [enabled, userId]);
}

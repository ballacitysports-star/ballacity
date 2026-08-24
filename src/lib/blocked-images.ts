import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Quarantined / removed images must never render anywhere in the app, even
 * when a stale URL is still stored on a profile, team, gym or game row.
 * The blocklist is a tiny `bucket/path` set fetched once per session.
 */

let cache: Promise<Set<string>> | null = null;
const listeners = new Set<(s: Set<string>) => void>();
let current: Set<string> = new Set();

async function fetchBlocked(): Promise<Set<string>> {
  try {
    const { data, error } = await (supabase as any).rpc("blocked_image_paths");
    if (error) throw error;
    const set = new Set<string>(
      ((data ?? []) as { bucket: string; path: string }[]).map((r) => `${r.bucket}/${r.path}`),
    );
    current = set;
    listeners.forEach((l) => l(set));
    return set;
  } catch {
    return current;
  }
}

export function loadBlockedImages(): Promise<Set<string>> {
  if (!cache) cache = fetchBlocked();
  return cache;
}

/** Force a refetch (after a moderation action). */
export function refreshBlockedImages(): Promise<Set<string>> {
  cache = fetchBlocked();
  return cache;
}

const OBJECT_MARKERS = [
  "/storage/v1/object/public/",
  "/storage/v1/object/sign/",
  "/storage/v1/render/image/public/",
  "/storage/v1/render/image/sign/",
];

/** `bucket/path` for a Storage URL, or `null` for non-storage sources. */
export function storageKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = OBJECT_MARKERS.find((m) => url.includes(m));
  if (!marker) return null;
  const rest = url.slice(url.indexOf(marker) + marker.length).split("?")[0];
  return rest ? decodeURIComponent(rest) : null;
}

export function isBlockedNow(url: string | null | undefined): boolean {
  const key = storageKeyFromUrl(url);
  return !!key && current.has(key);
}

/** `true` while the given image is quarantined or removed. */
export function useBlockedImage(url: string | null | undefined): boolean {
  const key = storageKeyFromUrl(url);
  const [blocked, setBlocked] = useState(() => (key ? current.has(key) : false));

  useEffect(() => {
    if (!key) {
      setBlocked(false);
      return;
    }
    let alive = true;
    const listener = (s: Set<string>) => alive && setBlocked(s.has(key));
    listeners.add(listener);
    void loadBlockedImages().then((s) => alive && setBlocked(s.has(key)));
    return () => {
      alive = false;
      listeners.delete(listener);
    };
  }, [key]);

  return blocked;
}

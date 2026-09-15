import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { signPublicGameCover } from "@/lib/media-urls.functions";
import { MEDIA_SIGNED_URL_TTL_SECONDS, buildMediaRef, resolvableMediaRef } from "@/lib/media-refs";

type CacheEntry = { url: string; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();

/** Re-sign a little early so a URL never expires mid-render. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

async function sign(bucket: string, path: string): Promise<string | null> {
  const key = buildMediaRef(bucket, path);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.url;

  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async () => {
    // First as the signed-in user, so Storage RLS decides (owner, participant,
    // conversation member…). Falls back to the public game-cover signer for
    // visitors browsing an open game.
    const { data } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, MEDIA_SIGNED_URL_TTL_SECONDS);
    let url = data?.signedUrl ?? null;
    if (!url && bucket === "game-covers") {
      try {
        const res = await signPublicGameCover({ data: { ref: key } });
        url = res?.url ?? null;
      } catch {
        url = null;
      }
    }
    if (url) {
      cache.set(key, {
        url,
        expiresAt: Date.now() + MEDIA_SIGNED_URL_TTL_SECONDS * 1000 - REFRESH_MARGIN_MS,
      });
    }
    return url;
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

/**
 * Turn a stored media value into something usable in `src`.
 *
 * Public values (bundled assets, public bucket URLs, remote images) pass
 * through untouched. Private references — `storage://bucket/path` or a legacy
 * signed URL — are exchanged for a freshly signed, one-hour URL so access is
 * re-authorised on every view instead of riding a permanent token.
 */
export function useMediaUrl(value: string | null | undefined): string | null {
  const ref = resolvableMediaRef(value);
  const [resolved, setResolved] = useState<string | null>(() => {
    if (!ref) return value ?? null;
    const hit = cache.get(buildMediaRef(ref.bucket, ref.path));
    return hit && hit.expiresAt > Date.now() ? hit.url : null;
  });

  useEffect(() => {
    if (!ref) {
      setResolved(value ?? null);
      return;
    }
    let active = true;
    void sign(ref.bucket, ref.path).then((url) => {
      if (active) setResolved(url);
    });
    return () => {
      active = false;
    };
  }, [value, ref?.bucket, ref?.path]);

  return resolved;
}

/** Imperative variant for non-React callers (share cards, downloads). */
export async function resolveMediaUrl(value: string | null | undefined): Promise<string | null> {
  const ref = resolvableMediaRef(value);
  if (!ref) return value ?? null;
  return sign(ref.bucket, ref.path);
}

/** Drop cached signatures — used on sign-out so nothing leaks across sessions. */
export function clearMediaUrlCache(): void {
  cache.clear();
  inflight.clear();
}

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  MEDIA_SIGNED_URL_TTL_SECONDS,
  isPrivateMediaBucket,
  parseMediaRef,
  parseStorageMediaUrl,
} from "@/lib/media-refs";

/**
 * Public fallback signer for game covers.
 *
 * Storage RLS lets hosts and participants sign a game cover themselves from the
 * browser, but a visitor browsing an open game has no session. This function
 * mints a short-lived URL *only* for covers attached to a game that is not
 * private — the same audience the public game listing already exposes. Anything
 * else (private games, other buckets) is refused and must be signed by a
 * permitted, signed-in caller.
 */
export const signPublicGameCover = createServerFn({ method: "GET" })
  .inputValidator((d: { ref: string }) => z.object({ ref: z.string().min(1).max(600) }).parse(d))
  .handler(async ({ data }) => {
    const parsed = parseMediaRef(data.ref) ?? parseStorageMediaUrl(data.ref);
    if (!parsed || !isPrivateMediaBucket(parsed.bucket)) return { url: null as string | null };
    if (parsed.bucket !== "game-covers") return { url: null as string | null };
    // Reject traversal / wildcard probing outright.
    if (parsed.path.includes("..") || parsed.path.includes("%")) return { url: null as string | null };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: games } = await supabaseAdmin
      .from("hosted_games")
      .select("id,is_private,image")
      .ilike("image", `%${parsed.path}%`)
      .limit(2);

    const usable = (games ?? []).some((g: any) => g.is_private !== true);
    if (!usable) return { url: null as string | null };

    const { data: signed } = await supabaseAdmin.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.path, MEDIA_SIGNED_URL_TTL_SECONDS);

    return { url: signed?.signedUrl ?? null };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isPublicGame } from "@/lib/city-seo";
import {
  MEDIA_SIGNED_URL_TTL_SECONDS,
  isPrivateMediaBucket,
  parseMediaRef,
  parseStorageMediaUrl,
} from "@/lib/media-refs";

function isSameMedia(stored: string | null, wanted: { bucket: string; path: string }): boolean {
  const ref = parseMediaRef(stored) ?? parseStorageMediaUrl(stored);
  return !!ref && ref.bucket === wanted.bucket && ref.path === wanted.path;
}

/**
 * Public fallback signer for game covers.
 *
 * Storage RLS lets hosts and participants sign a game cover themselves from the
 * browser, but a visitor browsing an open game has no session. This function
 * mints a short-lived URL *only* for covers attached to a game that is not
 * public to everyone (isPublicGame: not private, hidden, cancelled or
 * organization-hidden, and an adult-only age range), the same audience the public
 * game listing already exposes. Anything else (restricted games, other buckets)
 * is refused and must be signed by a permitted, signed-in caller.
 */
export const signPublicGameCover = createServerFn({ method: "GET" })
  .inputValidator((d: { ref: string }) => z.object({ ref: z.string().min(1).max(600) }).parse(d))
  .handler(async ({ data }) => {
    const parsed = parseMediaRef(data.ref) ?? parseStorageMediaUrl(data.ref);
    if (!parsed || !isPrivateMediaBucket(parsed.bucket)) return { url: null as string | null };
    if (parsed.bucket !== "game-covers") return { url: null as string | null };
    // Reject traversal / wildcard probing outright.
    if (parsed.path.includes("..") || parsed.path.includes("%"))
      return { url: null as string | null };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Only a cover of a game that is public to everyone (isPublicGame, the shared rule) is
    // signed. A restricted game, a missing one and a failed lookup all give the same null.
    const { data: games, error: gamesError } = await supabaseAdmin
      .from("hosted_games")
      .select("id,image,is_private,hidden_at,org_hidden_at,cancelled_at,min_age,max_age")
      // The path is data, not a pattern: escape LIKE wildcards so it can only match itself.
      .ilike("image", `%${parsed.path.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`)
      .limit(10);

    const usable =
      !gamesError &&
      (games ?? []).some(
        (g) =>
          // The cover must be this game's own cover: the stored reference or legacy signed URL
          // has to resolve to exactly the requested bucket and path, not merely contain it.
          isSameMedia(g.image, parsed) &&
          typeof g.is_private === "boolean" &&
          isPublicGame({
            is_private: g.is_private,
            hidden_at: g.hidden_at ?? null,
            org_hidden_at: g.org_hidden_at ?? null,
            cancelled_at: g.cancelled_at ?? null,
            min_age: g.min_age ?? null,
            max_age: g.max_age ?? null,
          }),
      );
    if (!usable) return { url: null as string | null };

    const { data: signed } = await supabaseAdmin.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.path, MEDIA_SIGNED_URL_TTL_SECONDS);

    return { url: signed?.signedUrl ?? null };
  });

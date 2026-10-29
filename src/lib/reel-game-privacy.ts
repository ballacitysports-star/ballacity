import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FEED_GAME_COLUMNS,
  publicFeedGame,
  type FeedGame,
  type FeedGameRow,
} from "@/lib/highlight-feed-game";

/** What a public reel shows in place of host-written text when its game is not public. */
export const GENERIC_REEL_TITLE = "Highlight";

export type ReelGameAccess = {
  /** Linked games that are public to everyone, by id. Empty if the lookup failed. */
  publicGames: Map<string, FeedGame>;
  /** Linked games the viewer hosts or plays in, by trusted server-side state. */
  viewerGameIds: Set<string>;
};

/**
 * Which linked games a public reel may reveal. Reads with the service role, which ignores row
 * level security, so the shared public-game rule (publicFeedGame, built on isPublicGame) is
 * applied here. Fails closed: a failed lookup means no game is public and the viewer has access
 * to none.
 */
export async function loadReelGameAccess(
  admin: SupabaseClient,
  gameIds: readonly string[],
  viewerId: string | null,
): Promise<ReelGameAccess> {
  const ids = Array.from(new Set(gameIds.filter(Boolean)));
  const out: ReelGameAccess = { publicGames: new Map(), viewerGameIds: new Set() };
  if (ids.length === 0) return out;

  const { data: games, error } = await admin
    .from("hosted_games")
    .select(`${FEED_GAME_COLUMNS},host_id`)
    .in("id", ids);
  if (!error) {
    for (const g of (games ?? []) as (FeedGameRow & { host_id?: string | null })[]) {
      const visible = publicFeedGame(g);
      if (visible) out.publicGames.set(visible.id, visible);
      if (viewerId && g.host_id === viewerId) out.viewerGameIds.add(g.id);
    }
  }

  // Games that are not public are only open to their host and players. The viewer id comes from
  // the verified session on the server, never from the request.
  if (viewerId && !error) {
    const restricted = ids.filter((id) => !out.publicGames.has(id) && !out.viewerGameIds.has(id));
    if (restricted.length > 0) {
      const { data: joined, error: joinedError } = await admin
        .from("game_participants")
        .select("game_id")
        .eq("user_id", viewerId)
        .in("game_id", restricted);
      if (!joinedError) {
        for (const r of (joined ?? []) as { game_id: string }[]) out.viewerGameIds.add(r.game_id);
      }
    }
  }
  return out;
}

export type ReelText = { title: string; caption: string | null; hashtags: string[] };

/**
 * The host-written text a public reel may show. A reel linked to a game that is not public
 * shows a generic title and no caption or hashtags, because that text can name the game. The
 * reel's owner, and a viewer who hosts or plays in the game, still see it. The stored text is
 * never changed; only this public representation is.
 */
export function publicReelText(args: {
  gameId: string | null | undefined;
  ownerId: string | null | undefined;
  viewerId: string | null;
  access: ReelGameAccess;
  text: ReelText;
}): ReelText {
  const { gameId, ownerId, viewerId, access, text } = args;
  if (!gameId) return text;
  if (access.publicGames.has(gameId)) return text;
  if (viewerId && ownerId && viewerId === ownerId) return text;
  if (viewerId && access.viewerGameIds.has(gameId)) return text;
  return { title: GENERIC_REEL_TITLE, caption: null, hashtags: [] };
}

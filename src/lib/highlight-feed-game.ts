import { isPublicGame } from "@/lib/city-seo";

/** Columns of hosted_games the feed reads: the card's facts plus what decides if it is public. */
export const FEED_GAME_COLUMNS =
  "id,title,sport,date,location,is_private,hidden_at,org_hidden_at,cancelled_at,min_age,max_age";

export type FeedGameRow = {
  id: string;
  title: string | null;
  sport: string | null;
  date: string | null;
  location: string | null;
  is_private: boolean | null;
  hidden_at: string | null;
  org_hidden_at: string | null;
  cancelled_at: string | null;
  min_age: number | null;
  max_age: number | null;
};

export type FeedGame = {
  id: string;
  title: string;
  sport: string | null;
  date: string | null;
  location: string | null;
};

/**
 * The linked-game facts a public highlight card may show, or null. The feed reads games with
 * the service role, which ignores row level security, so the same public-game rule the city
 * pages use (isPublicGame) is applied here. A game that is missing, restricted, or could not be
 * verified gives null, never the reel's stored game_title or id: the card then shows the reel
 * without a game, and says nothing about why.
 */
export function publicFeedGame(row: FeedGameRow | null | undefined): FeedGame | null {
  if (!row || typeof row.id !== "string") return null;
  // Missing eligibility data is not permission: an unknown flag is treated as restricted.
  if (typeof row.is_private !== "boolean") return null;
  const eligible = isPublicGame({
    is_private: row.is_private,
    hidden_at: row.hidden_at ?? null,
    org_hidden_at: row.org_hidden_at ?? null,
    cancelled_at: row.cancelled_at ?? null,
    min_age: row.min_age ?? null,
    max_age: row.max_age ?? null,
  });
  if (!eligible || !row.title) return null;
  return {
    id: row.id,
    title: row.title,
    sport: row.sport ?? null,
    date: row.date ?? null,
    location: row.location ?? null,
  };
}

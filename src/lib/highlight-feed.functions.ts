import { createServerFn } from "@tanstack/react-start";

/**
 * Public highlight feed: every athlete's visible, finished reels in one
 * reverse-chronological scroll.
 *
 * Rows are gated by the "Anyone can view visible completed reels" policy and
 * this handler applies the same filter itself. Signed URLs are minted
 * server-side because the storage bucket only allows owners to read objects
 * directly. Avatars go through `visible_avatars`, which — with no caller
 * identity here — only ever returns publicly visible ones.
 */
export type HighlightFeedItem = {
  id: string;
  title: string;
  caption: string | null;
  hashtags: string[];
  sport: string | null;
  videoUrl: string | null;
  /**
   * Original upload, signed as a second chance: when the device can't decode
   * the primary copy the player silently retries this one.
   */
  fallbackVideoUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  author: {
    id: string;
    displayName: string;
    username: string | null;
    avatarUrl: string | null;
    initials: string | null;
  };
  game: {
    id: string;
    title: string;
    sport: string | null;
    /** Kickoff time of the linked game, so the card can show real timing. */
    date: string | null;
    location: string | null;
  } | null;
};

const PAGE_SIZE = 8;

export const listHighlightFeed = createServerFn({ method: "GET" })
  .inputValidator((input: { cursor?: string | null; sport?: string | null; limit?: number } | undefined) => ({
    cursor: typeof input?.cursor === "string" && input.cursor ? input.cursor : null,
    sport: typeof input?.sport === "string" && input.sport ? input.sport : null,
    limit: Math.min(Math.max(Number(input?.limit) || PAGE_SIZE, 1), 20),
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("highlight_reels")
      .select(
        "id,user_id,title,ai_title,ai_caption,ai_hashtags,ai_sport,video_path,playback_path,thumbnail_path,created_at,game_id,game_title",
      )
      .eq("status", "completed")
      .is("hidden_at", null)
      .order("created_at", { ascending: false })
      .limit(data.limit + 1);
    if (data.sport) q = q.eq("ai_sport", data.sport);
    if (data.cursor) q = q.lt("created_at", data.cursor);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const page = ((rows ?? []) as any[]).slice(0, data.limit);
    const hasMore = ((rows ?? []) as any[]).length > data.limit;
    if (page.length === 0) return { items: [] as HighlightFeedItem[], nextCursor: null };

    const userIds = Array.from(new Set(page.map((r) => r.user_id as string)));
    const gameIds = Array.from(
      new Set(page.map((r) => r.game_id as string | null).filter((id): id is string => !!id)),
    );

    const [{ data: profiles }, { data: avatars }, { data: games }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id,display_name,username,avatar_initials")
        .in("id", userIds),
      supabaseAdmin.rpc("visible_avatars" as never, { _ids: userIds } as never),
      gameIds.length > 0
        ? supabaseAdmin
            .from("hosted_games")
            .select("id,title,sport,date,location")
            .in("id", gameIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const profileById = new Map(((profiles ?? []) as any[]).map((p) => [p.id as string, p]));
    const avatarById = new Map(((avatars ?? []) as any[]).map((a) => [a.id as string, a]));
    const gameById = new Map(((games ?? []) as any[]).map((g) => [g.id as string, g]));

    const items: HighlightFeedItem[] = await Promise.all(
      page.map(async (r) => {
        const [video, thumb] = await Promise.all([
          supabaseAdmin.storage
            .from("highlight-videos")
            .createSignedUrl(r.playback_path ?? r.video_path, 3600),
          r.thumbnail_path
            ? supabaseAdmin.storage
                .from("highlight-videos")
                .createSignedUrl(r.thumbnail_path, 3600)
            : Promise.resolve({ data: null as { signedUrl?: string } | null }),
        ]);
        const profile = profileById.get(r.user_id as string);
        const avatar = avatarById.get(r.user_id as string);
        const game = r.game_id ? gameById.get(r.game_id as string) : null;
        return {
          id: r.id as string,
          title: (r.ai_title as string) || (r.title as string) || "Highlight",
          caption: (r.ai_caption as string) ?? null,
          hashtags: ((r.ai_hashtags as string[]) ?? []).slice(0, 6),
          sport: (r.ai_sport as string) ?? (game?.sport as string) ?? null,
          videoUrl: video.data?.signedUrl ?? null,
          thumbnailUrl: (thumb as any)?.data?.signedUrl ?? null,
          createdAt: r.created_at as string,
          author: {
            id: r.user_id as string,
            displayName:
              (avatar?.display_name as string) ?? (profile?.display_name as string) ?? "Player",
            username: (profile?.username as string) ?? null,
            avatarUrl: (avatar?.avatar_url as string) ?? null,
            initials:
              (avatar?.avatar_initials as string) ?? (profile?.avatar_initials as string) ?? null,
          },
          game: game
            ? {
                id: game.id as string,
                title: (game.title as string) ?? (r.game_title as string) ?? "Game",
                sport: (game.sport as string) ?? null,
                date: (game.date as string) ?? null,
                location: (game.location as string) ?? null,
              }
            : r.game_id
              ? {
                  id: r.game_id as string,
                  title: (r.game_title as string) ?? "Game",
                  sport: null,
                  date: null,
                  location: null,
                }
              : null,
        };
      }),
    );

    return {
      items,
      nextCursor: hasMore ? (page[page.length - 1].created_at as string) : null,
    };
  });

/** Distinct sports across the public feed, for the filter chips. */
export const listHighlightFeedSports = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("highlight_reels")
    .select("ai_sport")
    .eq("status", "completed")
    .is("hidden_at", null)
    .not("ai_sport", "is", null)
    .limit(400);
  if (error) throw new Error(error.message);
  const seen = new Set<string>();
  for (const row of (data ?? []) as any[]) {
    const s = String(row.ai_sport ?? "").trim();
    if (s) seen.add(s);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
});

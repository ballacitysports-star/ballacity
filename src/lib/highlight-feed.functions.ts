import { createServerFn } from "@tanstack/react-start";
import { loadReelGameAccess, publicReelText } from "@/lib/reel-game-privacy";

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

/** How many recent eligible reels the Following strip looks through (P3-2). */
export const FOLLOWING_SCAN_PAGES = 3;
const SCAN_PAGE = 50;

/**
 * Ids of reels by people the viewer follows, newest first (P3-2, Home → Following).
 * Eligibility (age cohort, audience, finished and visible) stays in SQL via
 * public_reel_feed_ids; this only keeps the eligible reels whose author the viewer
 * follows, looking through the most recent FOLLOWING_SCAN_PAGES pages.
 */
type ScanResult = { data: unknown; error: { message: string } | null };
type ScanQuery = PromiseLike<ScanResult> & {
  select: (cols: string) => ScanQuery;
  eq: (col: string, v: unknown) => ScanQuery;
  in: (col: string, v: readonly unknown[]) => ScanQuery;
  order: (col: string, opts?: { ascending?: boolean }) => ScanQuery;
  limit: (n: number) => ScanQuery;
};
/** The slice of the admin client the Following scan uses. */
export type FollowingScanClient = { from: (table: string) => ScanQuery };

export async function followedEligibleReelIds<C extends FollowingScanClient>(
  admin: C,
  eligibleFeedReelIds: (
    admin: C,
    args: { cursor: string | null; sport: string | null; limit: number; includeMembers: boolean },
  ) => Promise<string[]>,
  args: { viewerId: string; sport: string | null; want: number },
): Promise<string[]> {
  const { data: follows, error: fErr } = await admin
    .from("follows")
    .select("followee_id")
    .eq("follower_id", args.viewerId)
    .limit(1000);
  if (fErr) throw new Error(fErr.message);
  const followees = new Set(
    ((follows ?? []) as { followee_id: string }[]).map((f) => String(f.followee_id)),
  );
  if (followees.size === 0) return [];

  const out: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < FOLLOWING_SCAN_PAGES && out.length < args.want; page += 1) {
    const ids = await eligibleFeedReelIds(admin, {
      cursor,
      sport: args.sport,
      limit: SCAN_PAGE,
      includeMembers: true, // the viewer is signed in
    });
    if (ids.length === 0) break;
    const { data: rows, error } = await admin
      .from("highlight_reels")
      .select("id,user_id,created_at")
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as { id: string; user_id: string; created_at: string }[];
    for (const r of list) {
      if (followees.has(String(r.user_id)) && out.length < args.want) out.push(String(r.id));
    }
    if (ids.length < SCAN_PAGE || list.length === 0) break;
    cursor = String(list[list.length - 1].created_at);
  }
  return out;
}

export const listHighlightFeed = createServerFn({ method: "GET" })
  .inputValidator(
    (
      input:
        | { cursor?: string | null; sport?: string | null; limit?: number; following?: boolean }
        | undefined,
    ) => ({
      cursor: typeof input?.cursor === "string" && input.cursor ? input.cursor : null,
      sport: typeof input?.sport === "string" && input.sport ? input.sport : null,
      limit: Math.min(Math.max(Number(input?.limit) || PAGE_SIZE, 1), 20),
      following: input?.following === true,
    }),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { eligibleFeedReelIds, optionalSupabaseUserId, quarantinedMediaPaths, signablePath } =
      await import("@/lib/reel-visibility.server");

    const { ownedMediaPathOrNull } = await import("@/lib/media-path-guard");

    // Age-cohort gate lives in SQL: children and locked child accounts are
    // never returned, and 16-17 year olds only for signed-in viewers.
    const viewerId = await optionalSupabaseUserId();
    // Following (P3-2): only for a signed-in viewer; one strip, no paging.
    if (data.following && !viewerId) return { items: [] as HighlightFeedItem[], nextCursor: null };
    const ids = data.following
      ? await followedEligibleReelIds(supabaseAdmin, eligibleFeedReelIds, {
          viewerId: viewerId as string,
          sport: data.sport,
          want: data.limit,
        })
      : await eligibleFeedReelIds(supabaseAdmin, {
          cursor: data.cursor,
          sport: data.sport,
          limit: data.limit + 1,
          includeMembers: viewerId !== null,
        });
    if (ids.length === 0) return { items: [] as HighlightFeedItem[], nextCursor: null };

    const { data: rows, error } = await supabaseAdmin
      .from("highlight_reels")
      .select(
        "id,user_id,title,ai_title,ai_caption,ai_hashtags,ai_sport,video_path,playback_path,thumbnail_path,created_at,game_id",
      )
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const page = ((rows ?? []) as any[]).slice(0, data.limit);
    const hasMore = !data.following && ((rows ?? []) as any[]).length > data.limit;
    if (page.length === 0) return { items: [] as HighlightFeedItem[], nextCursor: null };

    const userIds = Array.from(new Set(page.map((r) => r.user_id as string)));
    const gameIds = Array.from(
      new Set(page.map((r) => r.game_id as string | null).filter((id): id is string => !!id)),
    );

    const [{ data: profiles }, { data: avatars }, access] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id,display_name,username,avatar_initials")
        .in("id", userIds),
      supabaseAdmin.rpc("visible_avatars" as never, { _ids: userIds } as never),
      // Linked-game details and host-written reel text are shown only for a game that is public
      // (the shared rule). A failed lookup shows neither.
      loadReelGameAccess(supabaseAdmin, gameIds, viewerId),
    ]);

    const profileById = new Map(((profiles ?? []) as any[]).map((p) => [p.id as string, p]));
    const avatarById = new Map(((avatars ?? []) as any[]).map((a) => [a.id as string, a]));
    const gameById = access.publicGames;

    const quarantined = await quarantinedMediaPaths(
      supabaseAdmin,
      page.flatMap((r) => [r.playback_path, r.video_path, r.thumbnail_path]),
    );

    const items: HighlightFeedItem[] = await Promise.all(
      page.map(async (r) => {
        // Only ever sign objects inside the reel owner's own folder, and never
        // a path quarantined for child safety.
        const owner = r.user_id as string;
        const primaryPath = signablePath(
          ownedMediaPathOrNull(owner, r.playback_path ?? r.video_path),
          quarantined,
        );
        const originalPath = r.playback_path
          ? signablePath(ownedMediaPathOrNull(owner, r.video_path), quarantined)
          : null;
        const thumbPath = signablePath(ownedMediaPathOrNull(owner, r.thumbnail_path), quarantined);

        const [video, original, thumb] = await Promise.all([
          primaryPath
            ? supabaseAdmin.storage.from("highlight-videos").createSignedUrl(primaryPath, 3600)
            : Promise.resolve({ data: null as { signedUrl?: string } | null }),
          originalPath
            ? supabaseAdmin.storage.from("highlight-videos").createSignedUrl(originalPath, 3600)
            : Promise.resolve({ data: null as { signedUrl?: string } | null }),
          thumbPath
            ? supabaseAdmin.storage.from("highlight-videos").createSignedUrl(thumbPath, 3600)
            : Promise.resolve({ data: null as { signedUrl?: string } | null }),
        ]);
        const profile = profileById.get(r.user_id as string);
        const avatar = avatarById.get(r.user_id as string);
        const game = r.game_id ? (gameById.get(r.game_id as string) ?? null) : null;
        return {
          id: r.id as string,
          ...publicReelText({
            gameId: r.game_id as string | null,
            ownerId: r.user_id as string,
            viewerId,
            access,
            text: {
              title: (r.ai_title as string) || (r.title as string) || "Highlight",
              caption: (r.ai_caption as string) ?? null,
              hashtags: ((r.ai_hashtags as string[]) ?? []).slice(0, 6),
            },
          }),
          sport: (r.ai_sport as string) ?? game?.sport ?? null,
          videoUrl: video.data?.signedUrl ?? null,
          fallbackVideoUrl: (original as any)?.data?.signedUrl ?? null,
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
          game,
        };
      }),
    );

    return {
      items,
      nextCursor: hasMore ? (page[page.length - 1].created_at as string) : null,
    };
  });

/**
 * Distinct sports across the public feed, for the filter chips. Uses the same
 * age-cohort audience gate as the feed itself, in SQL.
 */
export const listHighlightFeedSports = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { optionalSupabaseUserId } = await import("@/lib/reel-visibility.server");
  const viewerId = await optionalSupabaseUserId();

  const { data, error } = await supabaseAdmin.rpc(
    "public_reel_feed_sports" as never,
    {
      _include_members: viewerId !== null,
    } as never,
  );
  if (error) throw new Error(error.message);
  const seen = new Set<string>();
  for (const row of (data ?? []) as any[]) {
    const s = (typeof row === "string" ? row : String(row?.sport ?? row?.ai_sport ?? "")).trim();
    if (s) seen.add(s);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
});

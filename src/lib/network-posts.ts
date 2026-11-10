import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  NETWORK_POSTS_SETTING_KEY,
  parseNetworkPostsFlag,
  postErrorMessage,
  type PostAudience,
  type PostedAs,
} from "@/lib/network-posts-rules";

export * from "@/lib/network-posts-rules";

/**
 * Network posts (P1-2) for client code: the feature flag, the feed query and deleting.
 * Row level security decides what a viewer gets back.
 */

/** Whether posts are switched on (public app_settings row). Off while loading or on error. */
export function useNetworkPostsEnabled(): boolean {
  const q = useQuery({
    queryKey: ["app-setting", NETWORK_POSTS_SETTING_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", NETWORK_POSTS_SETTING_KEY)
        .maybeSingle();
      if (error || !data) return false;
      return parseNetworkPostsFlag((data as { value: unknown }).value);
    },
    staleTime: 60_000,
  });
  return q.data === true;
}

export type FeedPost = {
  id: string;
  authorId: string;
  postedAs: PostedAs;
  teamId: string | null;
  orgId: string | null;
  audience: PostAudience;
  body: string;
  moderationStatus: "pending" | "approved" | "held";
  createdAt: string;
  authorName: string;
  authorAvatar: string | null;
};

export const FEED_PAGE_SIZE = 20;

type PostRow = {
  id: string;
  author_id: string;
  posted_as: PostedAs;
  team_id: string | null;
  org_id: string | null;
  audience: PostAudience;
  body: string;
  moderation_status: FeedPost["moderationStatus"];
  created_at: string;
};

/**
 * The newest posts the viewer may see, newest first. Row level security decides what is
 * returned; this only pages and attaches display names (a team's or facility's name when
 * it posted, otherwise the author's).
 */
export async function listFeedPosts(before?: string | null): Promise<FeedPost[]> {
  let q = supabase
    .from("posts" as never)
    .select(
      "id, author_id, posted_as, team_id, org_id, audience, body, moderation_status, created_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(FEED_PAGE_SIZE);
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q;
  if (error) throw new Error(postErrorMessage(error.message));
  return decorate((data ?? []) as unknown as PostRow[]);
}

type RpcCall = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

type TeamNewsRow = {
  id: string;
  team_id: string;
  kind: string;
  title: string;
  body: string | null;
  created_at: string;
};

/** Team announcements and recaps as feed items, under the team's name. */
async function teamNewsAsPosts(rows: TeamNewsRow[]): Promise<FeedPost[]> {
  if (rows.length === 0) return [];
  const teamIds = [...new Set(rows.map((r) => r.team_id))];
  const { data } = await supabase.from("teams").select("id, name, avatar_url").in("id", teamIds);
  const teams = new Map(
    ((data ?? []) as { id: string; name: string | null; avatar_url: string | null }[]).map((t) => [
      t.id,
      t,
    ]),
  );
  return rows.map((r) => ({
    id: `news-${r.id}`,
    authorId: "",
    postedAs: "team" as PostedAs,
    teamId: r.team_id,
    orgId: null,
    audience: "public" as PostAudience,
    body: [r.title, r.body].filter(Boolean).join("\n"),
    moderationStatus: "approved" as const,
    createdAt: r.created_at,
    authorName: teams.get(r.team_id)?.name ?? "Team",
    authorAvatar: teams.get(r.team_id)?.avatar_url ?? null,
  }));
}

/**
 * Following (P1-3, Home feed F2), newest first: posts from people, teams and facilities the
 * viewer follows (and teams they belong to), merged with announcements and recaps from teams
 * they follow or belong to. Both functions run as the viewer, so row level security applies.
 */
export async function listFollowingPosts(before?: string | null): Promise<FeedPost[]> {
  const rpc = supabase.rpc as unknown as RpcCall;
  const args = { _before: before ?? null, _limit: FEED_PAGE_SIZE };
  const [posts, news] = await Promise.all([
    rpc("following_feed", args),
    rpc("following_team_news", args),
  ]);
  if (posts.error) throw new Error(postErrorMessage(posts.error.message));
  const merged = [
    ...(await decorate((posts.data ?? []) as PostRow[])),
    // Team news is a bonus: if it fails, the posts still show.
    ...(news.error ? [] : await teamNewsAsPosts((news.data ?? []) as TeamNewsRow[])),
  ];
  return merged
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, FEED_PAGE_SIZE);
}

/** Attaches display names: a team's or facility's when it posted, otherwise the author's. */
async function decorate(rows: PostRow[]): Promise<FeedPost[]> {
  if (rows.length === 0) return [];

  const ids = (pick: (r: PostRow) => string | null) => [
    ...new Set(rows.map(pick).filter((x): x is string => !!x)),
  ];
  const authorIds = ids((r) => r.author_id);
  const teamIds = ids((r) => (r.posted_as === "team" ? r.team_id : null));
  const orgIds = ids((r) => (r.posted_as === "org" ? r.org_id : null));
  const [profiles, teams, orgs] = await Promise.all([
    supabase.from("profiles").select("id, display_name, avatar_url").in("id", authorIds),
    teamIds.length
      ? supabase.from("teams").select("id, name, avatar_url").in("id", teamIds)
      : Promise.resolve({ data: [] }),
    orgIds.length
      ? supabase.from("trainer_orgs").select("id, name, avatar_url").in("id", orgIds)
      : Promise.resolve({ data: [] }),
  ]);
  type Named = {
    id: string;
    display_name?: string | null;
    name?: string | null;
    avatar_url?: string | null;
  };
  const byId = (list: unknown) => new Map(((list ?? []) as Named[]).map((x) => [x.id, x]));
  const people = byId(profiles.data);
  const teamMap = byId(teams.data);
  const orgMap = byId(orgs.data);

  return rows.map((r) => {
    const who =
      r.posted_as === "team"
        ? teamMap.get(r.team_id ?? "")
        : r.posted_as === "org"
          ? orgMap.get(r.org_id ?? "")
          : people.get(r.author_id);
    return {
      id: r.id,
      authorId: r.author_id,
      postedAs: r.posted_as,
      teamId: r.team_id,
      orgId: r.org_id,
      audience: r.audience,
      body: r.body,
      moderationStatus: r.moderation_status,
      createdAt: r.created_at,
      authorName: (who?.name ?? who?.display_name ?? "").trim() || "BallaCity member",
      authorAvatar: who?.avatar_url ?? null,
    };
  });
}

/** The author removes their own post. It stays in the database, marked deleted. */
export async function deletePost(id: string): Promise<void> {
  const { error } = await supabase
    .from("posts" as never)
    .update({ deleted_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw new Error(postErrorMessage(error.message));
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type FollowUser = {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  avatar_initials: string | null;
  viewerFollows: boolean;
};

export type FollowListKind = "followers" | "following";

export const FOLLOW_PAGE_SIZE = 30;

export type FollowPage = {
  users: FollowUser[];
  nextCursor: string | null;
};

export async function listFollows(
  userId: string,
  kind: FollowListKind,
  cursor?: string | null,
  pageSize: number = FOLLOW_PAGE_SIZE,
  viewerId?: string | null,
): Promise<FollowPage> {
  const col = kind === "followers" ? "followee_id" : "follower_id";
  const otherCol = kind === "followers" ? "follower_id" : "followee_id";
  let q = supabase
    .from("follows" as any)
    .select(otherCol + ", created_at")
    .eq(col, userId)
    .order("created_at", { ascending: false })
    .limit(pageSize);
  if (cursor) q = q.lt("created_at", cursor);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const ids = rows.map((r) => r[otherCol]).filter(Boolean);
  const nextCursor = rows.length === pageSize ? (rows[rows.length - 1].created_at as string) : null;
  if (ids.length === 0) return { users: [], nextCursor };
  const [profsRes, mineRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, username, avatar_url, avatar_initials")
      .in("id", ids),
    viewerId
      ? supabase
          .from("follows" as any)
          .select("followee_id")
          .eq("follower_id", viewerId)
          .in("followee_id", ids)
      : Promise.resolve({ data: [], error: null } as any),
  ]);
  if (profsRes.error) throw profsRes.error;
  const byId = new Map(((profsRes.data ?? []) as any[]).map((p) => [p.id, p]));
  const mineSet = new Set(((mineRes as any).data ?? []).map((r: any) => r.followee_id as string));
  const users: FollowUser[] = ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((p: any) => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      avatar_url: p.avatar_url,
      avatar_initials: p.avatar_initials,
      viewerFollows: mineSet.has(p.id),
    }));
  return { users, nextCursor };
}

export type FollowState = {
  isFollowing: boolean;
  followers: number;
  following: number;
};

export async function getFollowState(
  followeeId: string,
  viewerId: string | null,
): Promise<FollowState> {
  const [followersRes, followingRes, meRes] = await Promise.all([
    supabase
      .from("follows" as any)
      .select("*", { count: "exact", head: true })
      .eq("followee_id", followeeId),
    supabase
      .from("follows" as any)
      .select("*", { count: "exact", head: true })
      .eq("follower_id", followeeId),
    viewerId
      ? supabase
          .from("follows" as any)
          .select("follower_id")
          .eq("follower_id", viewerId)
          .eq("followee_id", followeeId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
  ]);
  return {
    followers: followersRes.count ?? 0,
    following: followingRes.count ?? 0,
    isFollowing: !!(meRes as any)?.data,
  };
}

export async function followUser(followeeId: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to follow");
  const { error } = await supabase
    .from("follows" as any)
    .insert({ follower_id: u.user.id, followee_id: followeeId } as any);
  if (error && !/duplicate/i.test(error.message)) throw error;
}

export async function unfollowUser(followeeId: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to unfollow");
  const { error } = await supabase
    .from("follows" as any)
    .delete()
    .eq("follower_id", u.user.id)
    .eq("followee_id", followeeId);
  if (error) throw error;
}

export function useFollow(followeeId: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const viewerId = user?.id ?? null;
  const key = ["follow", followeeId, viewerId];

  const query = useQuery({
    queryKey: key,
    queryFn: () => getFollowState(followeeId, viewerId),
    staleTime: 15_000,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const cur = query.data;
      if (cur?.isFollowing) await unfollowUser(followeeId);
      else await followUser(followeeId);
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<FollowState>(key);
      if (prev) {
        qc.setQueryData<FollowState>(key, {
          ...prev,
          isFollowing: !prev.isFollowing,
          followers: prev.followers + (prev.isFollowing ? -1 : 1),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["follow", followeeId] });
      qc.invalidateQueries({ queryKey: ["follow-list"] });
    },
  });

  return {
    ...(query.data ?? { isFollowing: false, followers: 0, following: 0 }),
    loading: query.isLoading,
    pending: mutation.isPending,
    toggle: () => mutation.mutate(),
  };
}

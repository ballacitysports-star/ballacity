import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

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
    },
  });

  return {
    ...(query.data ?? { isFollowing: false, followers: 0, following: 0 }),
    loading: query.isLoading,
    pending: mutation.isPending,
    toggle: () => mutation.mutate(),
  };
}

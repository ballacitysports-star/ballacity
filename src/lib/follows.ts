import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

type RpcResult = { data: unknown; error: { message: string } | null };

/** The follow functions are newer than the generated database types, so call them by name. */
function rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  return (
    supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<RpcResult> }
  ).rpc(fn, args);
}

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
  /** The viewer has asked to follow and is waiting for approval. */
  requested: boolean;
  followers: number;
  following: number;
};

/** What following an account did: it followed, or it needs the account's approval first. */
export type FollowOutcome = "following" | "requested";

export async function getFollowState(
  followeeId: string,
  viewerId: string | null,
): Promise<FollowState> {
  const [followersRes, followingRes, meRes, requestRes] = await Promise.all([
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
    viewerId
      ? supabase
          .from("follow_requests" as never)
          .select("requester_id")
          .eq("requester_id", viewerId)
          .eq("target_id", followeeId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  return {
    followers: followersRes.count ?? 0,
    following: followingRes.count ?? 0,
    isFollowing: !!(meRes as { data?: unknown })?.data,
    requested: !!(requestRes as { data?: unknown })?.data,
  };
}

/**
 * Follows an account, or asks to when it needs approval. The database decides which:
 * there is no direct insert into `follows`.
 */
export async function followUser(followeeId: string): Promise<FollowOutcome> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to follow");
  const { data, error } = await rpc("request_follow", { _target: followeeId });
  if (error) throw new Error(followErrorMessage(error.message));
  return data === "requested" ? "requested" : "following";
}

/** Withdraws a follow request the viewer sent. */
export async function cancelFollowRequest(targetId: string) {
  const { error } = await rpc("cancel_follow_request", { _target: targetId });
  if (error) throw new Error(followErrorMessage(error.message));
}

function followErrorMessage(message: string): string {
  if (/FOLLOW_LOCKED/.test(message))
    return "A parent or guardian needs to approve your account first.";
  if (/NOT_SIGNED_IN/.test(message)) return "Sign in to follow";
  if (/FOLLOW_NOT_ALLOWED/.test(message)) return "You can't change this account's followers.";
  if (/NO_SUCH_FOLLOW_REQUEST/.test(message)) return "That request is no longer there.";
  if (/INVALID_FOLLOW_TARGET/.test(message)) return "That account isn't available.";
  return message;
}

export type FollowRequest = {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  avatar_initials: string | null;
  requestedAt: string;
};

/**
 * Requests waiting for `targetId`. The database only returns them to that account,
 * its verified guardian, or the person who sent them.
 */
export async function listFollowRequests(targetId: string): Promise<FollowRequest[]> {
  const { data, error } = await supabase
    .from("follow_requests" as never)
    .select("requester_id, created_at")
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{ requester_id: string; created_at: string }>;
  const ids = rows.map((r) => r.requester_id);
  if (ids.length === 0) return [];
  const { data: profs, error: perr } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url, avatar_initials")
    .in("id", ids);
  if (perr) throw perr;
  const byId = new Map(
    ((profs ?? []) as Array<Omit<FollowRequest, "requestedAt">>).map((p) => [p.id, p]),
  );
  return rows
    .map((r) => {
      const p = byId.get(r.requester_id);
      return p
        ? {
            id: p.id,
            display_name: p.display_name,
            username: p.username,
            avatar_url: p.avatar_url,
            avatar_initials: p.avatar_initials,
            requestedAt: r.created_at,
          }
        : null;
    })
    .filter((r): r is FollowRequest => r !== null);
}

/** Approve or decline a request for `targetId` (the account itself, or its guardian). */
export async function respondToFollowRequest(
  requesterId: string,
  targetId: string,
  approve: boolean,
) {
  const { error } = await rpc("respond_follow_request", {
    _requester: requesterId,
    _target: targetId,
    _approve: approve,
  });
  if (error) throw new Error(followErrorMessage(error.message));
}

/** Remove one of `targetId`'s followers (the account itself, or its guardian). */
export async function removeFollower(targetId: string, followerId: string) {
  const { error } = await rpc("remove_follower", { _target: targetId, _follower: followerId });
  if (error) throw new Error(followErrorMessage(error.message));
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
    mutationFn: async (): Promise<FollowOutcome | "unfollowed" | "withdrawn"> => {
      const cur = query.data;
      if (cur?.isFollowing) {
        await unfollowUser(followeeId);
        return "unfollowed";
      }
      if (cur?.requested) {
        await cancelFollowRequest(followeeId);
        return "withdrawn";
      }
      return followUser(followeeId);
    },
    onSuccess: (outcome) => {
      // Following an account that needs approval only sends a request, so the
      // state is set from what the database said, not guessed beforehand.
      const prev = qc.getQueryData<FollowState>(key);
      if (!prev) return;
      qc.setQueryData<FollowState>(key, {
        ...prev,
        isFollowing: outcome === "following",
        requested: outcome === "requested",
        followers:
          prev.followers + (outcome === "following" ? 1 : outcome === "unfollowed" ? -1 : 0),
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["follow", followeeId] });
      qc.invalidateQueries({ queryKey: ["follow-list"] });
    },
  });

  return {
    ...(query.data ?? { isFollowing: false, requested: false, followers: 0, following: 0 }),
    loading: query.isLoading,
    pending: mutation.isPending,
    toggle: () => mutation.mutate(),
  };
}

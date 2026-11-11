import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Following a team, a trainer (both `teams` rows) or a facility (`trainer_orgs`). Person
 * follows live in `follows` and lib/follows.ts; these are separate because an entity id is
 * not an account id. The database decides everything: follow_entity refuses hidden,
 * unclaimed and blocked targets and accounts still waiting for a parent, and no one but
 * the follower (and their guardian) can see who follows what. The owner gets a count.
 */
export type EntityKind = "team" | "org";

export type EntityFollowState = { following: boolean; followers: number };

type RpcResult = { data: unknown; error: { message: string } | null };

/** The entity follow functions are newer than the generated database types. */
function rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  return (
    supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<RpcResult> }
  ).rpc(fn, args);
}

/** Turns a database refusal into words for the member. Unknown errors pass through. */
export function entityFollowErrorMessage(message: string): string {
  if (/FOLLOW_LOCKED/.test(message))
    return "A parent or guardian needs to approve your account first.";
  if (/NOT_SIGNED_IN/.test(message)) return "Sign in to follow";
  // Blocked and unavailable read the same, so a refusal does not reveal a block.
  if (/FOLLOW_BLOCKED|INVALID_FOLLOW_TARGET/.test(message)) return "This page can't be followed.";
  return message;
}

export async function getEntityFollowState(
  kind: EntityKind,
  id: string,
): Promise<EntityFollowState> {
  const { data, error } = await rpc("entity_follow_state", { _kind: kind, _id: id });
  if (error) throw new Error(entityFollowErrorMessage(error.message));
  const row = (Array.isArray(data) ? data[0] : data) as EntityFollowState | undefined;
  return { following: !!row?.following, followers: Number(row?.followers ?? 0) };
}

export async function followEntity(kind: EntityKind, id: string): Promise<void> {
  const { error } = await rpc("follow_entity", { _kind: kind, _id: id });
  if (error) throw new Error(entityFollowErrorMessage(error.message));
}

export async function unfollowEntity(kind: EntityKind, id: string): Promise<void> {
  const { error } = await rpc("unfollow_entity", { _kind: kind, _id: id });
  if (error) throw new Error(entityFollowErrorMessage(error.message));
}

/** State and toggle for one entity. Signed-out viewers get the empty state and no query. */
export function useEntityFollow(kind: EntityKind, id: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const viewerId = user?.id ?? null;
  const key = ["entity-follow", kind, id, viewerId];

  const query = useQuery({
    queryKey: key,
    queryFn: () => getEntityFollowState(kind, id),
    enabled: !!viewerId,
    staleTime: 15_000,
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<"followed" | "unfollowed"> => {
      if (query.data?.following) {
        await unfollowEntity(kind, id);
        return "unfollowed";
      }
      await followEntity(kind, id);
      return "followed";
    },
    onSuccess: (outcome) => {
      const prev = qc.getQueryData<EntityFollowState>(key);
      if (!prev) return;
      qc.setQueryData<EntityFollowState>(key, {
        following: outcome === "followed",
        followers: Math.max(0, prev.followers + (outcome === "followed" ? 1 : -1)),
      });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Something went wrong"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["entity-follow", kind, id] }),
  });

  return {
    following: query.data?.following ?? false,
    followers: query.data?.followers ?? null,
    loading: query.isLoading,
    pending: mutation.isPending,
    toggle: () => mutation.mutate(),
  };
}

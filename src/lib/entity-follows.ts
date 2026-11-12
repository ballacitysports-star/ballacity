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

export type EntityFollowCount = { followers: number; following: boolean };

/** entity_follow_counts reads at most this many ids per call. */
const FOLLOW_COUNTS_BATCH = 200;

/**
 * Follower counts for a list of entities (entity_follow_counts, one call per 200 ids):
 * counts only, and nothing for an entity the caller cannot see.
 */
export async function getEntityFollowCounts(
  kind: EntityKind,
  ids: string[],
): Promise<Map<string, EntityFollowCount>> {
  const out = new Map<string, EntityFollowCount>();
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += FOLLOW_COUNTS_BATCH) {
    batches.push(ids.slice(i, i + FOLLOW_COUNTS_BATCH));
  }
  const results = await Promise.all(
    batches.map((batch) => rpc("entity_follow_counts", { _kind: kind, _ids: batch })),
  );
  for (const { data, error } of results) {
    if (error) throw new Error(entityFollowErrorMessage(error.message));
    for (const row of (Array.isArray(data) ? data : []) as {
      id: string;
      followers: number;
      following: boolean;
    }[]) {
      out.set(row.id, { followers: Number(row.followers ?? 0), following: !!row.following });
    }
  }
  return out;
}

/**
 * Real follower counts for a list of cards (P1-1). Signed-out viewers get none (the
 * database answers signed-in callers only), and a failed call gives none too: cards then
 * show no number rather than a wrong one.
 */
export function useEntityFollowCounts(kind: EntityKind, ids: string[]) {
  const { user } = useAuth();
  const key = [...new Set(ids)].sort();
  const query = useQuery({
    queryKey: ["entity-follow-counts", kind, key, user?.id ?? null],
    queryFn: () => getEntityFollowCounts(kind, key),
    enabled: !!user && key.length > 0,
    staleTime: 30_000,
  });
  return query.data ?? null;
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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["entity-follow", kind, id] });
      // The count on list cards (Discover, /teams, /trainers) changes with this follow too.
      qc.invalidateQueries({ queryKey: ["entity-follow-counts", kind] });
    },
  });

  return {
    following: query.data?.following ?? false,
    followers: query.data?.followers ?? null,
    loading: query.isLoading,
    pending: mutation.isPending,
    toggle: () => mutation.mutate(),
  };
}

import { useMemo } from "react";
import { useEntityFollowCounts, type EntityFollowCount } from "@/lib/entity-follows";
import { useAllOrgs } from "@/lib/org-store";

export type OrgFollowCounts = ReadonlyMap<string, EntityFollowCount> | null;

/**
 * Real follower counts for every team and trainer listing in the org store (P1-1), from one
 * entity_follow_counts query that Discover, /teams and /trainers share. It asks for the whole
 * store, not the cards on screen, so typing a search or changing a filter asks for nothing new.
 * Null while loading, for signed-out viewers and after a failed call: cards then show no number.
 */
export function useOrgFollowCounts(): OrgFollowCounts {
  const orgs = useAllOrgs();
  const ids = useMemo(() => orgs.map((o) => o.id), [orgs]);
  return useEntityFollowCounts("team", ids);
}

/** "Most followers" order by real counts, most first; a count not known yet reads as 0. */
export function followersDesc(counts: OrgFollowCounts, aId: string, bId: string): number {
  return (counts?.get(bId)?.followers ?? 0) - (counts?.get(aId)?.followers ?? 0);
}

import type { Org } from "@/lib/sample-data";

/** Open roster spots a team has posted: every sport → position count, added up. */
export function openSpotCount(positionsNeeded: Org["positionsNeeded"]): number {
  let total = 0;
  for (const byPosition of Object.values(positionsNeeded ?? {})) {
    for (const n of Object.values(byPosition ?? {})) {
      const count = Number(n);
      if (Number.isFinite(count) && count > 0) total += count;
    }
  }
  return total;
}

/**
 * The team to feature at the top of the Teams tab: a verified team that has
 * posted open spots, else any team that has. Nothing is featured when no team
 * is recruiting, so the banner never claims openings that aren't there.
 */
export function featuredRecruitingTeam<
  T extends Pick<Org, "kind" | "verified" | "positionsNeeded">,
>(orgs: T[]): T | undefined {
  const recruiting = orgs.filter((o) => o.kind === "team" && openSpotCount(o.positionsNeeded) > 0);
  return recruiting.find((o) => o.verified) ?? recruiting[0];
}

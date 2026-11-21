/**
 * Who a new game is hosted as (WP 3.0). Owner decision, 2026-11-19: an adult may host as themselves, without a team; a
 * 16-17-year-old hosts under a team they own; under-16s cannot host (the create page stops them before this). The server
 * enforces the same rules (migration 20261121100000_game_host_affiliation): a team must be one the host owns or manages, and a
 * game without a team must have an adult host.
 */

export type HostAffiliation =
  | { source: "self"; id: "self"; name: string }
  | { source: "team"; id: string; name: string; kind?: "team" | "coach" };

export type HostTeam = { id: string; name: string; kind?: "team" | "coach" };

/** The choices for "Host as": "You" first for an adult, then the teams the member owns (coach profiles are not offered). */
export function hostAffiliations(input: {
  teams: HostTeam[];
  cohort: string | null | undefined;
  selfName?: string | null;
}): HostAffiliation[] {
  const teams: HostAffiliation[] = input.teams
    .filter((t) => t.kind !== "coach")
    .map((t) => ({ source: "team" as const, id: t.id, name: t.name, kind: t.kind }));
  if (input.cohort !== "adult") return teams;
  const name = input.selfName?.trim() || "You";
  return [{ source: "self", id: "self", name }, ...teams];
}

/**
 * The choice to start with: the team the app is acting as; otherwise "You" when the app is acting as the person; otherwise
 * the only choice there is. Null means the member has to pick.
 */
export function preferredAffiliation(
  choices: HostAffiliation[],
  active: { teamId?: string | null; actingAsTeam: boolean },
): HostAffiliation | null {
  if (active.teamId) {
    const team = choices.find((c) => c.source === "team" && c.id === active.teamId);
    if (team) return team;
  }
  if (!active.actingAsTeam) {
    const self = choices.find((c) => c.source === "self");
    if (self) return self;
  }
  return choices.length === 1 ? choices[0] : null;
}

/** The team id a game is saved with: none when hosting as oneself. */
export function teamIdFor(choice: HostAffiliation | null): string | undefined {
  return choice?.source === "team" ? choice.id : undefined;
}

export function affiliationLabel(choice: HostAffiliation): string {
  return choice.source === "self" ? "You" : "Team";
}

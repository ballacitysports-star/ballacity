import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The team, trainer profile or gym a game was hosted as. A game made on behalf of
 * a team carries its `team_id`, and that team is who the game is "hosted by": the
 * person who set it up is the organizer. The same goes for an official event of a
 * gym (`org_id` with `org_official`, which the database decides). A game someone
 * simply holds at a gym ("community run") stays hosted by that person. Public
 * columns only, so it works for a signed-out visitor and a feed full of cards
 * shares one cached lookup per team or gym.
 */
export type GameHostTeam = {
  id: string;
  name: string;
  kind: "team" | "coach" | "gym";
  avatarUrl: string | null;
  initials: string;
  verified: boolean;
};

type TeamRow = {
  id: string;
  name: string | null;
  kind: string | null;
  avatar: string | null;
  avatar_url: string | null;
  verified: boolean | null;
};

const looksLikeUrl = (v: string | null | undefined) => !!v && /^(https?:\/\/|\/)/i.test(v);

export function toGameHostTeam(row: TeamRow): GameHostTeam {
  const name = (row.name ?? "").trim() || "Team";
  return {
    id: row.id,
    name,
    kind: row.kind === "coach" ? "coach" : "team",
    // A logo is stored either in avatar_url or, for older rows, as a URL in avatar.
    avatarUrl: row.avatar_url || (looksLikeUrl(row.avatar) ? row.avatar : null),
    initials: name.slice(0, 2).toUpperCase(),
    verified: !!row.verified,
  };
}

/** Where the host name links to. */
export function hostTeamLink(t: Pick<GameHostTeam, "id" | "kind">) {
  if (t.kind === "gym") return { to: "/orgs/$orgId", params: { orgId: t.id } } as const;
  return t.kind === "coach"
    ? ({ to: "/trainers/$trainerId", params: { trainerId: t.id } } as const)
    : ({ to: "/teams/$teamId", params: { teamId: t.id } } as const);
}

export function toGameHostOrg(row: {
  id: string;
  name: string | null;
  avatar: string | null;
  avatar_url: string | null;
  verified: boolean | null;
}): GameHostTeam {
  return { ...toGameHostTeam({ ...row, kind: "gym" }), kind: "gym" };
}

/** Which profile hosts a game, or null when it is hosted by a person. */
export function gameHostSource(game: {
  teamId?: string | null;
  orgId?: string | null;
  orgOfficial?: boolean | null;
}): { kind: "team"; id: string } | { kind: "gym"; id: string } | null {
  if (game.teamId) return { kind: "team", id: game.teamId };
  if (game.orgId && game.orgOfficial) return { kind: "gym", id: game.orgId };
  return null;
}

export function useGameHostTeam(teamId: string | null | undefined) {
  return useQuery({
    queryKey: ["game-host-team", teamId],
    enabled: !!teamId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<GameHostTeam | null> => {
      const { data, error } = await supabase
        .from("teams")
        .select("id,name,kind,avatar,avatar_url,verified")
        .eq("id", teamId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toGameHostTeam(data as TeamRow) : null;
    },
  });
}

function useGameHostOrg(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["game-host-org", orgId],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<GameHostTeam | null> => {
      const { data, error } = await supabase
        .from("trainer_orgs")
        .select("id,name,avatar,avatar_url,verified")
        .eq("id", orgId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toGameHostOrg(data) : null;
    },
  });
}

/** The team or gym a game is hosted as, or null when it is hosted by a person. */
export function useGameHost(
  game:
    | {
        teamId?: string | null;
        orgId?: string | null;
        orgOfficial?: boolean | null;
      }
    | null
    | undefined,
): GameHostTeam | null {
  const source = game ? gameHostSource(game) : null;
  const team = useGameHostTeam(source?.kind === "team" ? source.id : null).data ?? null;
  const org = useGameHostOrg(source?.kind === "gym" ? source.id : null).data ?? null;
  return team ?? org;
}

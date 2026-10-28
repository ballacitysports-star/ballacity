import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The team (or trainer profile) a game was hosted as. A game made on behalf of a
 * team carries its `team_id`, and that team is who the game is "hosted by": the
 * person who set it up is the organizer. Public columns only, so it works for a
 * signed-out visitor and a feed full of cards shares one cached lookup per team.
 */
export type GameHostTeam = {
  id: string;
  name: string;
  kind: "team" | "coach";
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
  return t.kind === "coach"
    ? ({ to: "/trainers/$trainerId", params: { trainerId: t.id } } as const)
    : ({ to: "/teams/$teamId", params: { teamId: t.id } } as const);
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

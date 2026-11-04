import { supabase } from "@/integrations/supabase/client";

/**
 * Who organizes a game, as far as this viewer may know (G4).
 *
 * For a host under 18 the database returns the name and photo only to the host, their verified guardian, people who share the game,
 * a team or a chat with them, staff dealing with them and administrators/moderators; everyone else gets a neutral organizer. This
 * is the one place to ask; do not infer an identity from `host_id`.
 */
export type GameOrganizer = {
  kind: "adult" | "minor" | "neutral";
  displayName: string | null;
  avatarUrl: string | null;
  relation: "self" | "guardian" | "staff" | "related" | "viewer" | "none";
};

type Row = {
  kind: string;
  display_name: string | null;
  avatar_url: string | null;
  relation: string;
};

export function toGameOrganizer(rows: Row[] | null | undefined): GameOrganizer | null {
  const r = rows?.[0];
  if (!r) return null;
  const kind = r.kind === "adult" || r.kind === "minor" ? r.kind : "neutral";
  return {
    kind,
    displayName: kind === "neutral" ? null : r.display_name,
    avatarUrl: kind === "neutral" ? null : r.avatar_url,
    relation: (["self", "guardian", "staff", "related", "viewer"].includes(r.relation)
      ? r.relation
      : "none") as GameOrganizer["relation"],
  };
}

/** Null when signed out, when the game cannot be read by this viewer, or on any error. */
export async function fetchGameOrganizer(gameId: string): Promise<GameOrganizer | null> {
  try {
    const { data, error } = await supabase.rpc(
      "get_game_organizer" as never,
      { _game: gameId } as never,
    );
    if (error) return null;
    return toGameOrganizer(data as Row[] | null);
  } catch {
    return null;
  }
}

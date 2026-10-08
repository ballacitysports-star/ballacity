import { createServerFn } from "@tanstack/react-start";

export type PlayerCardGame = {
  id: string;
  title: string;
  sport: string | null;
  date: string | null;
  location: string | null;
  role: "host" | "player";
};

export type PlayerCardData = {
  profile: {
    id: string;
    displayName: string;
    username: string | null;
    initials: string;
    avatarUrl: string | null;
    coverUrl: string | null;
    bio: string | null;
    city: string | null;
    sport: string | null;
    /** Guardian-authorised minor: contact goes to the guardian, no live schedule. */
    isMinor: boolean;
  } | null;
  games: PlayerCardGame[];
  stats: {
    gamesPlayed: number;
    gamesHosted: number;
    reels: number;
    sports: string[];
    upcoming: number;
  };
};

/**
 * Public, read-only summary used by the mobile player card page: profile
 * basics, recent/upcoming games (hosted + joined) and aggregate stats.
 * No auth required — only publicly shareable fields are returned.
 */
export const getPlayerCard = createServerFn({ method: "GET" })
  .inputValidator((input: { userId: string }) => {
    if (!input?.userId || typeof input.userId !== "string") {
      throw new Error("userId is required");
    }
    return { userId: input.userId };
  })
  .handler(async ({ data }): Promise<PlayerCardData> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cols = "id,title,sport,date,location,host_id,hidden_at,is_private";

    const empty: PlayerCardData = {
      profile: null,
      games: [],
      stats: { gamesPlayed: 0, gamesHosted: 0, reels: 0, sports: [], upcoming: 0 },
    };

    // Privacy gate: this endpoint is public, so only surface players whose
    // profile visibility is "public" and who are not suspended/hidden.
    const [{ data: visibility }, { data: flagRows }, { data: avatarRows }] = await Promise.all([
      supabaseAdmin.rpc("profile_visibility_of" as never, { _user: data.userId } as never),
      supabaseAdmin.rpc("public_privacy_flags" as never, { _ids: [data.userId] } as never),
      supabaseAdmin.rpc("visible_avatars" as never, { _ids: [data.userId] } as never),
    ]);
    if ((visibility as unknown as string) !== "public") return empty;

    const flags = ((flagRows ?? []) as any[])[0] ?? {};
    const avatar = ((avatarRows ?? []) as any[])[0] ?? {};
    const showGames = flags.show_games_played !== false;
    const showSports = flags.show_sports !== false;

    const [profRes, hostedRes, joinsRes, reelsRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select(
          "id, display_name, username, avatar_initials, cover_url, bio, city, sport, suspended_at, moderation_state",
        )
        .eq("id", data.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("hosted_games")
        .select(cols)
        .eq("host_id", data.userId)
        .is("hidden_at", null)
        .order("date", { ascending: false })
        .limit(40),
      supabaseAdmin
        .from("game_participants")
        .select("game_id")
        .eq("user_id", data.userId)
        .limit(120),
      supabaseAdmin
        .from("highlight_reels")
        .select("id", { count: "exact", head: true })
        .eq("user_id", data.userId)
        .eq("status", "completed")
        .eq("is_draft", false)
        .is("hidden_at", null),
    ]);

    const prof = profRes.data as any | null;
    if (!prof || prof.suspended_at) return empty;

    const { data: cohortRaw } = await supabaseAdmin.rpc("age_cohort_of" as never, { _user: data.userId } as never);
    const isMinor = ["child_under_13", "teen_13_15", "teen_16_17"].includes(cohortRaw as unknown as string);

    const hosted = showGames
      ? ((hostedRes.data ?? []) as any[])
          .filter((g) => g.is_private !== true)
          .map((g) => ({ ...g, role: "host" as const }))
      : [];
    const hostedIds = new Set(hosted.map((g) => g.id));
    const joinedIds = showGames
      ? ((joinsRes.data ?? []) as any[])
          .map((r) => r.game_id as string)
          .filter((id) => id && !hostedIds.has(id))
      : [];

    let joined: any[] = [];
    if (joinedIds.length > 0) {
      const { data: rows } = await supabaseAdmin
        .from("hosted_games")
        .select(cols)
        .in("id", joinedIds)
        .is("hidden_at", null)
        .order("date", { ascending: false })
        .limit(40);
      joined = ((rows ?? []) as any[])
        .filter((g) => g.is_private !== true)
        .map((g) => ({ ...g, role: "player" as const }));
    }

    const now = Date.now();
    const games: PlayerCardGame[] = [...hosted, ...joined]
      .map((g) => ({
        id: g.id as string,
        title: (g.title as string) ?? "Game",
        sport: (g.sport as string) ?? null,
        date: (g.date as string) ?? null,
        location: (g.location as string) ?? null,
        role: g.role as "host" | "player",
      }))
      // Minors: never publish where they will be — past games only, no venue.
      .filter((g) => !isMinor || new Date(g.date ?? 0).getTime() <= Date.now())
      .map((g) => (isMinor ? { ...g, location: null } : g))
      .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
      .slice(0, 30);

    const sports = showSports
      ? Array.from(new Set(games.map((g) => g.sport).filter((s): s is string => Boolean(s)))).slice(
          0,
          6,
        )
      : [];

    return {
      profile: {
        id: prof.id as string,
        displayName: (avatar.display_name as string) ?? (prof.display_name as string) ?? "Player",
        username: (prof.username as string) ?? null,
        initials:
          (avatar.avatar_initials as string) ??
          (prof.avatar_initials as string) ??
          ((prof.display_name as string) ?? "PL").slice(0, 2).toUpperCase(),
        avatarUrl: (avatar.avatar_url as string) ?? null,
        coverUrl: (prof.cover_url as string) ?? null,
        bio: (prof.bio as string) ?? null,
        city: (prof.city as string) ?? null,
        sport: showSports ? ((prof.sport as string) ?? null) : null,
        isMinor,
      },
      games,
      stats: {
        gamesPlayed: showGames
          ? games.filter((g) => new Date(g.date ?? 0).getTime() <= now).length
          : 0,
        gamesHosted: showGames ? hosted.length : 0,
        reels: reelsRes.count ?? 0,
        sports,
        upcoming: showGames ? games.filter((g) => new Date(g.date ?? 0).getTime() > now).length : 0,
      },
    };
  });

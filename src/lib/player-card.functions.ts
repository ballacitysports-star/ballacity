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
    const cols = "id,title,sport,date,location,host_id,hidden_at";

    const [profRes, hostedRes, joinsRes, reelsRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, display_name, username, avatar_initials, avatar_url, cover_url, bio, city, sport")
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
        .is("hidden_at", null),
    ]);

    const hosted = ((hostedRes.data ?? []) as any[]).map((g) => ({ ...g, role: "host" as const }));
    const hostedIds = new Set(hosted.map((g) => g.id));
    const joinedIds = ((joinsRes.data ?? []) as any[])
      .map((r) => r.game_id as string)
      .filter((id) => id && !hostedIds.has(id));

    let joined: any[] = [];
    if (joinedIds.length > 0) {
      const { data: rows } = await supabaseAdmin
        .from("hosted_games")
        .select(cols)
        .in("id", joinedIds)
        .is("hidden_at", null)
        .order("date", { ascending: false })
        .limit(40);
      joined = ((rows ?? []) as any[]).map((g) => ({ ...g, role: "player" as const }));
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
      .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
      .slice(0, 30);

    const prof = profRes.data as any | null;
    const sports = Array.from(
      new Set(games.map((g) => g.sport).filter((s): s is string => Boolean(s))),
    ).slice(0, 6);

    return {
      profile: prof
        ? {
            id: prof.id as string,
            displayName: (prof.display_name as string) ?? "Player",
            username: (prof.username as string) ?? null,
            initials:
              (prof.avatar_initials as string) ??
              ((prof.display_name as string) ?? "PL").slice(0, 2).toUpperCase(),
            avatarUrl: (prof.avatar_url as string) ?? null,
            coverUrl: (prof.cover_url as string) ?? null,
            bio: (prof.bio as string) ?? null,
            city: (prof.city as string) ?? null,
            sport: (prof.sport as string) ?? null,
          }
        : null,
      games,
      stats: {
        gamesPlayed: games.filter((g) => new Date(g.date ?? 0).getTime() <= now).length,
        gamesHosted: hosted.length,
        reels: reelsRes.count ?? 0,
        sports,
        upcoming: games.filter((g) => new Date(g.date ?? 0).getTime() > now).length,
      },
    };
  });

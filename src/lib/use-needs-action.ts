import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { listMyConversations } from "@/lib/messages";
import { buildNeedsAction, type NeedsActionItem, type TodayGame } from "@/lib/needs-action";

const STALE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type GameRow = {
  id: string;
  title: string | null;
  date: string;
  cancelled_at: string | null;
  completed_at: string | null;
};

/** Hosted games by id, keeping only ones that are still on. */
async function liveGames(ids: string[], fromIso: string, toIso: string): Promise<GameRow[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("hosted_games")
    .select("id, title, date, cancelled_at, completed_at")
    .in("id", ids)
    .gte("date", fromIso)
    .lte("date", toIso)
    .is("cancelled_at", null)
    .is("completed_at", null)
    .order("date", { ascending: true });
  return (data ?? []) as GameRow[];
}

/**
 * What is waiting on the signed-in member, from queries their own access already
 * allows. A failed query counts as nothing waiting: the strip is a convenience,
 * never an error message.
 */
export function useNeedsAction(): { items: NeedsActionItem[]; isLoading: boolean } {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const hostRequests = useQuery({
    queryKey: ["needs-action", "host-requests", uid],
    enabled: !!uid,
    staleTime: STALE_MS,
    retry: false,
    queryFn: async () => {
      const { data } = await supabase
        .from("join_requests")
        .select("game_id, created_at")
        .eq("host_id", uid!)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(100);
      const rows = (data ?? []) as { game_id: string; created_at: string }[];
      const ids = [...new Set(rows.map((r) => r.game_id))];
      if (ids.length === 0) return { count: 0, oldestGameId: null, oldestGameTitle: null };
      // A request on a game that is over or cancelled needs no answer.
      const since = new Date(Date.now() - DAY_MS).toISOString();
      const { data: games } = await supabase
        .from("hosted_games")
        .select("id, title")
        .in("id", ids)
        .gte("date", since)
        .is("cancelled_at", null)
        .is("completed_at", null);
      const live = new Map(
        ((games ?? []) as { id: string; title: string | null }[]).map((g) => [g.id, g.title]),
      );
      const open = rows.filter((r) => live.has(r.game_id));
      const oldest = open[0];
      return {
        count: open.length,
        oldestGameId: oldest?.game_id ?? null,
        oldestGameTitle: oldest ? (live.get(oldest.game_id) ?? null) : null,
      };
    },
  });

  const conversations = useQuery({
    queryKey: ["needs-action", "conversations", uid],
    enabled: !!uid,
    staleTime: STALE_MS,
    retry: false,
    queryFn: async () => {
      const list = await listMyConversations();
      return {
        unread: list.filter((c) => !c.is_request).reduce((n, c) => n + c.unread, 0),
        requests: list.filter((c) => c.is_request).length,
      };
    },
  });

  const gamesToday = useQuery({
    queryKey: ["needs-action", "games-today", uid],
    enabled: !!uid,
    staleTime: STALE_MS,
    retry: false,
    queryFn: async (): Promise<TodayGame[]> => {
      // From a little before now (a game already under way) to a day ahead.
      const from = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const to = new Date(Date.now() + DAY_MS).toISOString();
      const [{ data: hosted }, { data: joined }] = await Promise.all([
        supabase
          .from("hosted_games")
          .select("id")
          .eq("host_id", uid!)
          .gte("date", from)
          .lte("date", to),
        supabase.from("game_participants").select("game_id").eq("user_id", uid!),
      ]);
      const hostedIds = new Set(((hosted ?? []) as { id: string }[]).map((g) => g.id));
      const joinedIds = ((joined ?? []) as { game_id: string }[]).map((g) => g.game_id);
      const all = [...new Set([...hostedIds, ...joinedIds])];
      const games = await liveGames(all, from, to);
      return games.map((g) => ({
        id: g.id,
        title: g.title || "Your game",
        startsAt: g.date,
        role: hostedIds.has(g.id) ? ("host" as const) : ("player" as const),
      }));
    },
  });

  const items = useMemo(
    () =>
      buildNeedsAction({
        hostRequests: hostRequests.data ?? {
          count: 0,
          oldestGameId: null,
          oldestGameTitle: null,
        },
        unreadMessages: conversations.data?.unread ?? 0,
        messageRequests: conversations.data?.requests ?? 0,
        gamesToday: gamesToday.data ?? [],
      }),
    [hostRequests.data, conversations.data, gamesToday.data],
  );

  return {
    items,
    isLoading: hostRequests.isLoading || conversations.isLoading || gamesToday.isLoading,
  };
}

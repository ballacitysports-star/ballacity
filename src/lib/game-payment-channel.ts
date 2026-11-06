import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * P2-6: one realtime channel per game for the host's roster payment chips.
 *
 * Each roster row on the host's game page used to open its own channel on
 * payment_submissions (`payment_submissions:<gameId>:<playerId>`), so a 20-player
 * game held 20 open channels, each re-subscribed on every mount. Rows now share one
 * channel per game, filtered by game_id, and each row is told only about its own
 * player's rows. The channel opens with the first row and closes with the last.
 */
export type PaymentChangeRow = { game_id?: string; player_id?: string } | null;
type Listener = () => void;

type ChannelClient = {
  channel: (name: string) => RealtimeChannel;
  removeChannel: (channel: RealtimeChannel) => unknown;
};

type Entry = { channel: RealtimeChannel; byPlayer: Map<string, Set<Listener>> };

const registries = new WeakMap<ChannelClient, Map<string, Entry>>();

export function gamePaymentChannelName(gameId: string): string {
  return `payment_submissions:roster:${gameId}`;
}

/**
 * Call `listener` when a payment submission for (`gameId`, `playerId`) changes.
 * Returns the unsubscribe function; the shared channel is removed with its last listener.
 */
export function subscribeGamePaymentChanges(
  gameId: string,
  playerId: string,
  listener: Listener,
  client: ChannelClient = supabase as unknown as ChannelClient,
): () => void {
  let games = registries.get(client);
  if (!games) {
    games = new Map();
    registries.set(client, games);
  }

  let entry = games.get(gameId);
  if (!entry) {
    const byPlayer = new Map<string, Set<Listener>>();
    const channel = client
      .channel(gamePaymentChannelName(gameId))
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "payment_submissions",
          filter: `game_id=eq.${gameId}`,
        } as never,
        (payload: { new?: PaymentChangeRow; old?: PaymentChangeRow }) => {
          const row = (payload.new ?? payload.old) as PaymentChangeRow;
          if (row?.game_id && row.game_id !== gameId) return;
          // A row without a player id (for example a delete without the full old row)
          // cannot be routed, so every row on this game re-checks.
          const targets = row?.player_id ? [byPlayer.get(row.player_id)] : [...byPlayer.values()];
          for (const set of targets) for (const fn of set ?? []) fn();
        },
      )
      .subscribe();
    entry = { channel, byPlayer };
    games.set(gameId, entry);
  }

  const set = entry.byPlayer.get(playerId) ?? new Set<Listener>();
  set.add(listener);
  entry.byPlayer.set(playerId, set);

  let done = false;
  return () => {
    if (done) return;
    done = true;
    const current = games!.get(gameId);
    if (!current) return;
    const players = current.byPlayer.get(playerId);
    players?.delete(listener);
    if (players && players.size === 0) current.byPlayer.delete(playerId);
    if (current.byPlayer.size === 0) {
      games!.delete(gameId);
      client.removeChannel(current.channel);
    }
  };
}

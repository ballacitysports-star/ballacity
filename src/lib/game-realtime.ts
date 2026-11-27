import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { liveChannel, onLive } from "@/lib/realtime-channel";

type PayloadRow = { game_id?: string; player_id?: string } | null;

/**
 * Subscribes the game details view to the four Supabase realtime channels
 * that back the approval, roster, and payment status displays:
 *
 * - `join_requests:host:<gameId>:<userId>` — host-only; refreshes the host's
 *   pending/approved request list when any join_request for this game changes.
 * - `join_requests:me:<gameId>:<userId>` — viewer-scoped; fires when the
 *   viewer's own join_request row for the game flips status.
 * - `game_payment_settings:<gameId>` — game-scoped (public data); fires when
 *   the host toggles approval, fee, or accepted methods.
 * - `payment_submissions:me:<gameId>:<userId>` — viewer-scoped; fires when
 *   the host verifies/rejects the viewer's payment submission.
 *
 * Channel names include both `gameId` and `userId` (where the channel is
 * user-scoped) so that switching games OR accounts always tears down the
 * old channels and re-subscribes to a fresh set — the automated tests in
 * `game-realtime.test.tsx` pin this contract.
 *
 * Callbacks are stored in a ref so subscriptions do not churn when the
 * caller re-renders with new closures; only id/host changes cause
 * unsubscribe + resubscribe.
 *
 * Each channel holds SUBSCRIBED until the server streams its changes
 * (liveChannel) and calls its change callback on every SUBSCRIBED, the first
 * included: the caller's load on mount may have been answered before changes
 * were live, and changes made while a channel was down are not replayed.
 */
export function useGameRealtimeChannels(params: {
  gameId: string | undefined;
  userId: string | undefined;
  hostsThisGame: boolean;
  onHostJoinRequestChange: () => void;
  onMyJoinRequestChange: () => void;
  onSettingsChange: () => void;
  onMyPaymentChange: () => void;
}): void {
  const { gameId, userId, hostsThisGame } = params;

  const cbs = useRef(params);
  cbs.current = params;

  // Host-only: join_requests for this game.
  useEffect(() => {
    if (!gameId || !userId || !hostsThisGame) return;
    const channel = liveChannel(`join_requests:host:${gameId}:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "join_requests", filter: `game_id=eq.${gameId}` },
        (payload: { new?: PayloadRow; old?: PayloadRow }) => {
          const row = (payload.new ?? payload.old) as PayloadRow;
          if (row?.game_id !== gameId) return;
          cbs.current.onHostJoinRequestChange();
        },
      )
      .subscribe(
        onLive(
          () => cbs.current.onHostJoinRequestChange(),
          (status) => {
            if (status !== "SUBSCRIBED") {
              console.warn(`[realtime] join_requests:host channel status: ${status}`);
            }
          },
        ),
      );
    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, userId, hostsThisGame]);

  // Viewer-scoped: my join_request status for this game.
  useEffect(() => {
    if (!gameId || !userId) return;
    const channel = liveChannel(`join_requests:me:${gameId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "join_requests",
          filter: `player_id=eq.${userId}`,
        },
        (payload: { new?: PayloadRow; old?: PayloadRow }) => {
          const row = (payload.new ?? payload.old) as PayloadRow;
          if (row?.game_id === gameId) {
            cbs.current.onMyJoinRequestChange();
          }
        },
      )
      .subscribe(
        onLive(
          () => cbs.current.onMyJoinRequestChange(),
          (status) => {
            if (status !== "SUBSCRIBED") {
              console.warn(`[realtime] join_requests:me channel status: ${status}`);
            }
          },
        ),
      );
    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, userId]);

  // Game-scoped (public): payment settings.
  useEffect(() => {
    if (!gameId) return;
    const channel = liveChannel(`game_payment_settings:${gameId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_payment_settings",
          filter: `game_id=eq.${gameId}`,
        },
        (payload: { new?: PayloadRow; old?: PayloadRow }) => {
          const row = (payload.new ?? payload.old) as PayloadRow;
          if (row?.game_id !== gameId) return;
          cbs.current.onSettingsChange();
        },
      )
      .subscribe(
        onLive(
          () => cbs.current.onSettingsChange(),
          (status) => {
            if (status !== "SUBSCRIBED") {
              console.warn(`[realtime] game_payment_settings channel status: ${status}`);
            }
          },
        ),
      );
    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId]);

  // Viewer-scoped: my payment submission for this game.
  useEffect(() => {
    if (!gameId || !userId) return;
    const channel = liveChannel(`payment_submissions:me:${gameId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payment_submissions",
          filter: `game_id=eq.${gameId}`,
        },
        (payload: { new?: PayloadRow; old?: PayloadRow }) => {
          const row = (payload.new ?? payload.old) as PayloadRow;
          if (row?.game_id !== gameId) return;
          if (row?.player_id !== userId) return;
          cbs.current.onMyPaymentChange();
        },
      )
      .subscribe(
        onLive(
          () => cbs.current.onMyPaymentChange(),
          (status) => {
            if (status !== "SUBSCRIBED") {
              console.warn(`[realtime] payment_submissions:me channel status: ${status}`);
            }
          },
        ),
      );
    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, userId]);
}

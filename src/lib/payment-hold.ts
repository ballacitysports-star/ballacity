import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Spot holds on paid games: after the host approves a player, the spot is held
 * for `payment_hold_minutes`. If no payment is submitted in that window the
 * database releases it (`release_expired_payment_holds`). This module is the
 * client's view of the same rule — the countdown copy and the lazy sweep.
 */

export const PAYMENT_HOLD_OPTIONS: Array<{ minutes: number | null; label: string }> = [
  { minutes: null, label: "No auto-release" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
  { minutes: 720, label: "12 hours" },
  { minutes: 1440, label: "24 hours" },
];

/**
 * When an approved player's hold runs out, or null when no release will
 * happen: no hold configured, not approved yet, or the hold would only expire
 * after tip-off (holds never release once the game has started).
 */
export function holdExpiresAt(input: {
  approvedAt: string | null | undefined;
  holdMinutes: number | null | undefined;
  gameStartsAt: string | null | undefined;
}): Date | null {
  const { approvedAt, holdMinutes, gameStartsAt } = input;
  if (!approvedAt || !holdMinutes || holdMinutes <= 0) return null;
  const approved = new Date(approvedAt).getTime();
  if (Number.isNaN(approved)) return null;
  const expires = approved + holdMinutes * 60_000;
  if (gameStartsAt) {
    const start = new Date(gameStartsAt).getTime();
    if (!Number.isNaN(start) && expires >= start) return null;
  }
  return new Date(expires);
}

/** "1h 45m left to pay", "12m left to pay", "Hold expired". */
export function formatHoldRemaining(ms: number): string {
  if (ms <= 0) return "Hold expired";
  const totalMin = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m left to pay`;
  if (m === 0) return `${h}h left to pay`;
  return `${h}h ${m}m left to pay`;
}

/** Re-renders on an interval so countdowns stay current. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Ask the database to release this game's expired holds. Best-effort. */
export async function releaseExpiredHolds(gameId: string): Promise<number> {
  const { data, error } = await supabase.rpc("release_expired_payment_holds", {
    _game_id: gameId,
  });
  if (error) return 0;
  return typeof data === "number" ? data : 0;
}

/**
 * Lazy sweep while a paid game with holds is open on screen, so holds release
 * on time even where no scheduler runs. Realtime on join_requests then moves
 * everyone's UI along.
 */
export function usePaymentHoldSweep(gameId: string | undefined, enabled: boolean) {
  useEffect(() => {
    if (!gameId || !enabled) return;
    void releaseExpiredHolds(gameId);
    const t = window.setInterval(() => void releaseExpiredHolds(gameId), 60_000);
    return () => window.clearInterval(t);
  }, [gameId, enabled]);
}

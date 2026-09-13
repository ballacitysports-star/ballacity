/**
 * Per-player game reminders.
 *
 * Players pick lead times (30 min / 2 hours / 1 day …) when they RSVP; the
 * choices live in `game_reminders` (RLS: own rows only) so they follow the
 * player across devices. Due reminders are turned into notifications by
 * `flushMyDueGameReminders`, which the app calls on load and on an interval.
 */
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/** Default lead times applied when a player RSVPs without changing anything. */
export const DEFAULT_GAME_REMINDER_OFFSETS = [1440, 120] as const;

export async function getMyGameReminderOffsets(gameId: string): Promise<number[] | null> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from("game_reminders" as any)
    .select("offsets")
    .eq("game_id", gameId)
    .eq("user_id", uid)
    .maybeSingle();
  if (error) return null;
  const offsets = (data as any)?.offsets;
  return Array.isArray(offsets) ? offsets.map(Number).filter(Number.isFinite) : null;
}

/** Upsert the viewer's reminder lead times for a game (empty array = none). */
export async function saveMyGameReminderOffsets(
  gameId: string,
  offsets: number[],
): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return false;
  const clean = [...new Set(offsets.map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort(
    (a, b) => b - a,
  );
  const { error } = await supabase.from("game_reminders" as any).upsert(
    {
      game_id: gameId,
      user_id: uid,
      offsets: clean,
      // Re-arm delivery whenever the player changes their choices.
      last_sent_offset: null,
    } as any,
    { onConflict: "game_id,user_id" },
  );
  if (error) {
    console.warn("game reminder save failed", error.message);
    return false;
  }
  return true;
}

/** Clear the viewer's reminders for a game (used when they leave). */
export async function clearMyGameReminders(gameId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return;
  await supabase
    .from("game_reminders" as any)
    .delete()
    .eq("game_id", gameId)
    .eq("user_id", uid);
}

/**
 * Turns due reminders into notifications for the signed-in player. Runs on
 * mount and every 5 minutes while the app is open; the server side is
 * idempotent (it tracks the last offset it delivered per game).
 */
export function useGameReminderFlush() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    let active = true;
    const run = async () => {
      if (!active || typeof document === "undefined" || document.visibilityState === "hidden")
        return;
      try {
        const { flushMyDueGameReminders } = await import("@/lib/game-reminders.functions");
        await flushMyDueGameReminders();
      } catch (e: any) {
        console.warn("reminder flush failed", e?.message ?? e);
      }
    };
    void run();
    const id = window.setInterval(run, 5 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [user]);
}

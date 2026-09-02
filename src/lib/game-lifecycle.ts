import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Host lifecycle actions. Every one is a security-definer RPC: the database
 * re-checks that the caller is the host (or a moderator), so a spoofed client
 * call can't cancel or complete someone else's game.
 */

export async function cancelGame(gameId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("host_cancel_game", {
    _game_id: gameId,
    _reason: reason.trim() || null,
  });
  if (error) throw error;
}

export async function completeGame(gameId: string): Promise<void> {
  const { error } = await supabase.rpc("host_complete_game", { _game_id: gameId });
  if (error) throw error;
}

export async function markAttendance(
  gameId: string,
  userId: string,
  attended: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("host_mark_attendance", {
    _game_id: gameId,
    _user_id: userId,
    _attended: attended,
  });
  if (error) throw error;
}

export type HostAttendanceStats = {
  marked: number;
  attended: number;
  cancelledGames: number;
  completedGames: number;
  /** 0..1 share of marked roster spots that showed up, or null when unmarked. */
  attendanceRate: number | null;
};

export async function fetchHostAttendanceStats(
  hostId: string,
): Promise<HostAttendanceStats | null> {
  const { data, error } = await supabase.rpc("host_attendance_stats", { _host: hostId });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const marked = Number((row as { marked?: number }).marked ?? 0);
  const attended = Number((row as { attended?: number }).attended ?? 0);
  return {
    marked,
    attended,
    cancelledGames: Number((row as { cancelled_games?: number }).cancelled_games ?? 0),
    completedGames: Number((row as { completed_games?: number }).completed_games ?? 0),
    attendanceRate: marked > 0 ? attended / marked : null,
  };
}

/** Live host reliability numbers for the trust panel. */
export function useHostAttendanceStats(hostId: string | undefined): HostAttendanceStats | null {
  const [stats, setStats] = useState<HostAttendanceStats | null>(null);
  useEffect(() => {
    if (!hostId) {
      setStats(null);
      return;
    }
    let alive = true;
    void fetchHostAttendanceStats(hostId).then((s) => {
      if (alive) setStats(s);
    });
    return () => {
      alive = false;
    };
  }, [hostId]);
  return stats;
}

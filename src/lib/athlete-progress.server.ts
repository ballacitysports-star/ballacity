import { computeAthleteProgress, type AthleteProgress } from "@/lib/athlete-xp";

/**
 * Level and XP for one athlete from host-verified activity, using the same rules and
 * the same inputs as the passport. Used for minors, whose passport shows nothing.
 * Callers decide what may be shown; this only computes.
 */
export async function loadAthleteProgress(admin: any, userId: string): Promise<AthleteProgress> {
  const [rsvpRes, joinRes, hostedRes, lateRes] = await Promise.all([
    admin.from("tryout_rsvps").select("id").eq("user_id", userId).limit(50),
    admin.from("game_participants").select("game_id, attended").eq("user_id", userId).limit(500),
    admin
      .from("hosted_games")
      .select("id", { count: "exact", head: true })
      .eq("host_id", userId)
      .is("cancelled_at", null)
      .lt("date", new Date().toISOString()),
    admin
      .from("late_cancellations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("cancelled_by", userId),
  ]);

  let attendedTryouts = 0;
  const rsvpIds = ((rsvpRes.data ?? []) as { id: string }[]).map((r) => r.id);
  if (rsvpIds.length > 0) {
    const { data: evals } = await admin
      .from("tryout_evaluations")
      .select("rsvp_id")
      .in("rsvp_id", rsvpIds)
      .eq("attended", true);
    attendedTryouts = new Set(((evals ?? []) as { rsvp_id: string }[]).map((e) => e.rsvp_id)).size;
  }

  const marked = ((joinRes.data ?? []) as { game_id: string; attended: boolean | null }[]).filter(
    (r) => r.attended != null,
  );
  let dateOf = new Map<string, number>();
  if (marked.length > 0) {
    const { data: games } = await admin
      .from("hosted_games")
      .select("id, date")
      .in("id", marked.map((r) => r.game_id));
    dateOf = new Map(((games ?? []) as { id: string; date: string }[]).map((g) => [g.id, +new Date(g.date)]));
  }
  const history = [...marked]
    .sort((a, b) => (dateOf.get(b.game_id) ?? 0) - (dateOf.get(a.game_id) ?? 0))
    .map((r) => r.attended === true);

  return computeAthleteProgress({
    attendedRuns: history.filter(Boolean).length,
    noShows: history.filter((x) => !x).length,
    lateCancels: lateRes.count ?? 0,
    hostedGames: hostedRes.count ?? 0,
    attendedTryouts,
    attendanceHistory: history,
  });
}

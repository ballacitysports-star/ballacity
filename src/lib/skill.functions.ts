import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Skill votes and ratings. The vote insert runs as the caller so the database
 * trigger (shared game, adults only, 14-day window, daily cap) is the gate;
 * ratings are always computed server-side with the service role.
 */

export const submitSkillVote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { gameId: string; subjectId: string; vote: number }) => {
    const vote = Number(input?.vote);
    if (![-1, 0, 1].includes(vote)) throw new Error("Invalid vote");
    if (!input.gameId || !input.subjectId) throw new Error("Missing game or player");
    return { gameId: String(input.gameId), subjectId: String(input.subjectId), vote };
  })
  .handler(async ({ data, context }) => {
    const { data: game, error: gameError } = await context.supabase
      .from("hosted_games")
      .select("sport")
      .eq("id", data.gameId)
      .maybeSingle();
    if (gameError) throw new Error(gameError.message);
    if (!game?.sport) throw new Error("Game not found");
    const { error } = await context.supabase.from("skill_votes").insert({
      game_id: data.gameId,
      voter_id: context.userId,
      subject_id: data.subjectId,
      sport: game.sport,
      vote: data.vote,
    });
    if (error) {
      if (error.code === "23505") return { ok: true, duplicate: true };
      throw new Error(error.message);
    }
    // Best-effort: fold the new vote into the subject's rating right away.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { recomputeSkill } = await import("@/lib/skill-rating.server");
      const { data: v } = await supabaseAdmin
        .from("skill_votes")
        .select("sport")
        .eq("game_id", data.gameId)
        .eq("voter_id", context.userId)
        .eq("subject_id", data.subjectId)
        .maybeSingle();
      if (v?.sport) await recomputeSkill(supabaseAdmin, data.subjectId, v.sport);
    } catch {
      /* the vote is stored; the rating catches up on the next refresh */
    }
    return { ok: true, duplicate: false };
  });

/** Recomputes the caller's own ratings (free, no AI). */
export const refreshMySkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recomputeSkill, sportsWithSignals } = await import("@/lib/skill-rating.server");
    const sports = await sportsWithSignals(supabaseAdmin, context.userId);
    let updated = 0;
    for (const sport of sports) {
      if (await recomputeSkill(supabaseAdmin, context.userId, sport)) updated++;
    }
    return { updated };
  });

/** AI scouting report for one of the caller's sports. */
export const generateMySkillReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sport: string }) => {
    const sport = String(input?.sport ?? "")
      .trim()
      .slice(0, 40);
    if (!sport) throw new Error("Pick a sport");
    return { sport };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { generateSkillReport, recomputeSkill } = await import("@/lib/skill-rating.server");
    const est = await recomputeSkill(supabaseAdmin, context.userId, data.sport);
    if (!est)
      throw new Error(
        "Skill ratings are available for adults with a level or game history in this sport.",
      );
    return generateSkillReport(supabaseAdmin, context.userId, data.sport);
  });

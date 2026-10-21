import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeReviewExtras, safetyConcern } from "@/lib/review-questions";

/**
 * Review submission and AI follow-ups.
 *
 * The insert goes through the caller's own Supabase client, so the database's
 * `enforce_review_integrity` trigger and RLS stay the authorization boundary;
 * this layer only adds AI moderation in front of it and analysis after it.
 */

const KINDS = ["player", "trainer", "team", "host"] as const;
type Kind = (typeof KINDS)[number];
const isKind = (v: unknown): v is Kind => (KINDS as readonly string[]).includes(v as string);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The account whose profile a review is about (people directly, teams via their creator). */
async function revieweeUser(admin: any, kind: Kind, id: string): Promise<string | null> {
  if (kind === "player" || kind === "host") return UUID_RE.test(id) ? id : null;
  const { data } = await admin.from("teams").select("created_by").eq("id", id).maybeSingle();
  return (data?.created_by as string | null) ?? null;
}

export const submitReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      kind: string;
      revieweeKind: string;
      revieweeId: string;
      revieweeName: string;
      gameId?: string | null;
      rating: number;
      scores?: Record<string, number>;
      recommend?: unknown;
      answers?: unknown;
      tags?: unknown;
      title?: string;
      body: string;
      isPrivate?: boolean;
    }) => {
      if (!isKind(input?.kind) || !isKind(input?.revieweeKind)) throw new Error("Invalid review");
      const rating = Math.round(Number(input.rating));
      if (!(rating >= 1 && rating <= 5)) throw new Error("Pick a star rating");
      const body = String(input.body ?? "").trim();
      if (body.length < 8) throw new Error("Write at least a sentence.");
      // The headline answer is required here (the database only validates what
      // is present, so an older form keeps working until this one ships).
      const extras = normalizeReviewExtras(input.revieweeKind, input);
      return {
        kind: input.kind,
        revieweeKind: input.revieweeKind,
        revieweeId: String(input.revieweeId ?? "").slice(0, 120),
        revieweeName: String(input.revieweeName ?? "").slice(0, 120),
        gameId: input.gameId ? String(input.gameId).slice(0, 120) : null,
        rating,
        scores: input.scores ?? {},
        recommend: extras.recommend,
        answers: extras.answers,
        tags: extras.tags,
        title: input.title ? String(input.title).trim().slice(0, 120) : undefined,
        body: body.slice(0, 2000),
        isPrivate: input.isPrivate === true,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { moderateReviewText } = await import("@/lib/review-ai.server");

    // Screen before insert so blocked text is never stored where others can read it.
    const mod = await moderateReviewText(supabaseAdmin, {
      userId: context.userId,
      title: data.title,
      body: data.body,
    });
    if (mod.verdict === "block") {
      throw new Error(
        "That review can't be posted because it may break our community guidelines. Please keep feedback respectful and about the game.",
      );
    }

    const { data: row, error } = await context.supabase
      .from("reviews")
      .insert({
        reviewer_id: context.userId,
        kind: data.kind,
        reviewee_kind: data.revieweeKind,
        reviewee_id: data.revieweeId,
        reviewee_name: data.revieweeName,
        game_id: data.gameId,
        rating: data.rating,
        scores: data.scores,
        recommend: data.recommend,
        answers: data.answers,
        tags: data.tags,
        title: data.title ?? null,
        body: data.body,
        is_private: data.isPrivate,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // A "No" on a safety question is more than a low mark: also put it in the
    // moderators' report queue (the form tells the reviewer this before they
    // post). Best effort — the review itself is already saved.
    const concern = safetyConcern(data.revieweeKind, data.answers);
    if (concern) {
      try {
        const subject = await revieweeUser(supabaseAdmin, data.revieweeKind, data.revieweeId);
        if (subject && subject !== context.userId) {
          await supabaseAdmin.from("user_reports").insert({
            reporter_id: context.userId,
            reported_id: subject,
            reason: "unsafe_behavior",
            subject_type: data.gameId ? "game" : "user",
            game_id: data.gameId,
            details: `Raised in a review (id ${row.id}): answered "No" to "${concern.label}".`,
          });
        }
      } catch {
        /* the review is saved; moderators can still find it via the review itself */
      }
    }

    // Moderator couldn't clear it (or was unavailable): hold it for human review.
    let held = false;
    if (mod.verdict === "review") {
      await supabaseAdmin.from("reviews").update({ flagged: true }).eq("id", row.id);
      held = true;
    }
    return { id: row.id as string, held };
  });

/** Best-effort follow-up the client fires after a review posts: trait analysis, then summary. */
export const analyzeSubmittedReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reviewId: string }) => {
    if (!input?.reviewId) throw new Error("reviewId is required");
    return { reviewId: String(input.reviewId) };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { analyzeReview, refreshInsight } = await import("@/lib/review-ai.server");

    // RLS: only the author (or the subject, for private ones) can read this row.
    const { data: r } = await context.supabase
      .from("reviews")
      .select(
        "id, reviewer_id, reviewee_id, reviewee_kind, rating, title, body, flagged, is_private",
      )
      .eq("id", data.reviewId)
      .maybeSingle();
    if (!r || r.reviewer_id !== context.userId || r.flagged || r.is_private) return { ok: false };
    if (!isKind(r.reviewee_kind)) return { ok: false };

    const subject = await revieweeUser(supabaseAdmin, r.reviewee_kind, r.reviewee_id);
    await analyzeReview(supabaseAdmin, {
      revieweeUserId: subject,
      reviewId: r.id,
      revieweeKind: r.reviewee_kind,
      rating: r.rating,
      title: r.title,
      body: r.body,
    });
    await refreshInsight(supabaseAdmin, {
      revieweeUserId: subject,
      revieweeId: r.reviewee_id,
      revieweeKind: r.reviewee_kind,
    });
    return { ok: true };
  });

/** The person a profile is about can regenerate its AI summary on demand. */
export const refreshMyReputationSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { revieweeId: string; revieweeKind: string }) => {
    if (!isKind(input?.revieweeKind)) throw new Error("Invalid kind");
    return { revieweeId: String(input.revieweeId ?? ""), revieweeKind: input.revieweeKind };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { refreshInsight } = await import("@/lib/review-ai.server");
    const subject = await revieweeUser(supabaseAdmin, data.revieweeKind, data.revieweeId);
    if (!subject || subject !== context.userId) throw new Error("Only the owner can refresh this.");
    const draft = await refreshInsight(
      supabaseAdmin,
      { revieweeUserId: subject, ...data },
      { force: true },
    );
    if (!draft) throw new Error("Not enough reviews to summarize yet.");
    return draft;
  });

export const suggestReviewText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      revieweeKind: string;
      rating: number;
      highlights: string[];
      context?: string | null;
    }) => {
      if (!isKind(input?.revieweeKind)) throw new Error("Invalid kind");
      const highlights = (input.highlights ?? []).map((h) => String(h).trim()).filter(Boolean);
      if (highlights.length === 0) throw new Error("Tap a few things you noticed first.");
      return {
        revieweeKind: input.revieweeKind,
        rating: Math.min(5, Math.max(1, Math.round(Number(input.rating) || 3))),
        highlights: highlights.slice(0, 8),
        context: input.context ?? null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { suggestReviewDraft } = await import("@/lib/review-ai.server");
    return { draft: await suggestReviewDraft(supabaseAdmin, { userId: context.userId, ...data }) };
  });

/**
 * Database-backed review hooks.
 *
 * Reads go through RLS (public reviews, your own, private ones about you).
 * Writes are validated by `enforce_review_integrity` — eligibility, one review
 * per game, the 14-day window, minors and the daily cap all live in the
 * database, so nothing here is an authorization boundary.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  demoReviewees,
  demoReviewsFor,
  type Review,
  type ReviewerKind,
  type RevieweeKind,
} from "@/lib/reviews";
import type { Database } from "@/integrations/supabase/types";
import { analyzeSubmittedReview, submitReview } from "@/lib/reviews.functions";

type ReviewRow = Database["public"]["Tables"]["reviews"]["Row"];

const NO_REVIEWS: Review[] = [];

function initialsOf(name: string, fallback?: string | null): string {
  if (fallback) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "P") + (parts[1]?.[0] ?? "")).toUpperCase();
}

type ProfileLite = {
  id: string;
  display_name: string;
  username: string | null;
  avatar_initials: string | null;
};

export function rowToReview(row: ReviewRow, p?: ProfileLite): Review {
  const name = p?.display_name ?? "Player";
  return {
    id: row.id,
    reviewerId: row.reviewer_id,
    kind: row.kind as ReviewerKind,
    revieweeKind: row.reviewee_kind as RevieweeKind,
    revieweeId: row.reviewee_id,
    revieweeName: row.reviewee_name,
    reviewerName: name,
    reviewerHandle: p?.username ? `@${p.username}` : "",
    reviewerAvatar: initialsOf(name, p?.avatar_initials),
    rating: row.rating,
    scores: (row.scores ?? {}) as Record<string, number>,
    title: row.title ?? undefined,
    body: row.body,
    context: row.context ?? undefined,
    date: row.created_at,
    verified: row.verified,
    isPrivate: row.is_private,
    helpfulCount: row.helpful_count,
    flagged: row.flagged,
    gameId: row.game_id ?? undefined,
    sport: row.sport ?? undefined,
  };
}

async function profilesById(ids: string[]): Promise<Map<string, ProfileLite>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_initials")
    .in("id", ids);
  return new Map((data ?? []).map((p) => [p.id, p as ProfileLite]));
}

async function fetchReviewsFor(revieweeId: string): Promise<Review[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("reviewee_id", revieweeId)
    .neq("reviewee_kind", "gym")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = data ?? [];
  const profiles = await profilesById(Array.from(new Set(rows.map((r) => r.reviewer_id))));
  const { data: ai } = rows.length
    ? await supabase
        .from("review_ai_analysis")
        .select("review_id, mismatch")
        .in(
          "review_id",
          rows.map((r) => r.id),
        )
    : { data: [] };
  const mismatched = new Set((ai ?? []).filter((a) => a.mismatch).map((a) => a.review_id));
  return rows.map((r) => ({
    ...rowToReview(r, profiles.get(r.reviewer_id)),
    aiMismatch: mismatched.has(r.id),
  }));
}

/**
 * Reviews about an entity. "me" resolves to the signed-in user. Sample-data
 * entities (ids that never exist in the database) still show their demo seed.
 */
export function useReviewsFor(revieweeId: string): Review[] {
  const { user } = useAuth();
  const id = revieweeId === "me" ? (user?.id ?? "me") : revieweeId;
  const q = useQuery({
    queryKey: ["reviews", id, user?.id ?? null],
    queryFn: () => fetchReviewsFor(id),
    enabled: id !== "me" && id.length > 0,
    staleTime: 30_000,
  });
  return useMemo(() => {
    const demo = demoReviewsFor(revieweeId);
    if (!q.data?.length) return demo.length ? demo : NO_REVIEWS;
    return demo.length ? [...q.data, ...demo] : q.data;
  }, [q.data, revieweeId]);
}

export type ReviewBoardEntry = {
  revieweeId: string;
  revieweeKind: RevieweeKind;
  revieweeName: string;
  reviews: Review[];
};

/** Everything with public reviews, newest 500, grouped by reviewee (for /reviews). */
export function useReviewBoard(): ReviewBoardEntry[] {
  const q = useQuery({
    queryKey: ["reviews", "board"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .eq("is_private", false)
        .neq("reviewee_kind", "gym")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
  return useMemo(() => {
    const map = new Map<string, ReviewBoardEntry>();
    for (const row of q.data ?? []) {
      const r = rowToReview(row);
      const e = map.get(r.revieweeId) ?? {
        revieweeId: r.revieweeId,
        revieweeKind: r.revieweeKind,
        revieweeName: r.revieweeName,
        reviews: [],
      };
      e.reviews.push(r);
      map.set(r.revieweeId, e);
    }
    for (const d of demoReviewees()) {
      if (!map.has(d.revieweeId)) {
        map.set(d.revieweeId, { ...d, reviews: demoReviewsFor(d.revieweeId) });
      }
    }
    return Array.from(map.values());
  }, [q.data]);
}

// ---------------------------------------------------------------------------
// Eligibility — what the signed-in user can review right now (server-decided).
// ---------------------------------------------------------------------------

export type Reviewable = {
  revieweeKind: RevieweeKind;
  revieweeId: string;
  revieweeName: string;
  gameId: string | null;
  context: string | null;
  sport: string | null;
  happenedAt: string | null;
  closesAt: string | null;
};

export function useMyReviewable() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-reviewable", user?.id ?? null],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<Reviewable[]> => {
      const { data, error } = await supabase.rpc("my_reviewable", {});
      if (error) throw error;
      return (data ?? []).map((r) => ({
        revieweeKind: r.reviewee_kind as RevieweeKind,
        revieweeId: r.reviewee_id,
        revieweeName: r.reviewee_name,
        gameId: r.game_id,
        context: r.context,
        sport: r.sport,
        happenedAt: r.happened_at,
        closesAt: r.closes_at,
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type SubmitReviewInput = {
  kind: ReviewerKind;
  revieweeKind: RevieweeKind;
  revieweeId: string;
  revieweeName: string;
  gameId?: string | null;
  rating: number;
  scores: Record<string, number>;
  title?: string;
  body: string;
  isPrivate: boolean;
};

export function useSubmitReview() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitReviewInput) => {
      if (!user) throw new Error("Sign in to write a review.");
      const res = await submitReview({
        data: {
          kind: input.kind,
          revieweeKind: input.revieweeKind,
          revieweeId: input.revieweeId,
          revieweeName: input.revieweeName,
          gameId: input.gameId ?? null,
          rating: input.rating,
          scores: input.scores,
          title: input.title,
          body: input.body,
          isPrivate: input.isPrivate,
        },
      });
      // Trait analysis + summary refresh are best-effort and never block posting.
      if (!res.held && !input.isPrivate) {
        void analyzeSubmittedReview({ data: { reviewId: res.id } })
          .then(() => qc.invalidateQueries({ queryKey: ["reputation-insight"] }))
          .catch(() => undefined);
      }
      return res;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reviews"] });
      void qc.invalidateQueries({ queryKey: ["my-reviewable"] });
      void qc.invalidateQueries({ queryKey: ["player-activity-stats"] });
    },
  });
}

export type ReputationInsight = {
  summary: string;
  strengths: string[];
  growth: string[];
  reviewCount: number;
  generatedAt: string;
};

/** AI-written summary of a profile's reviews, if one has been generated. */
export function useReputationInsight(revieweeId: string, kind: RevieweeKind) {
  const { user } = useAuth();
  const id = revieweeId === "me" ? (user?.id ?? "me") : revieweeId;
  return useQuery({
    queryKey: ["reputation-insight", id, kind],
    enabled: id !== "me" && id.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ReputationInsight | null> => {
      const { data, error } = await supabase
        .from("reputation_insights")
        .select("summary, strengths, growth, review_count, generated_at")
        .eq("reviewee_id", id)
        .eq("reviewee_kind", kind)
        .maybeSingle();
      if (error) throw error;
      return data
        ? {
            summary: data.summary,
            strengths: data.strengths,
            growth: data.growth,
            reviewCount: data.review_count,
            generatedAt: data.generated_at,
          }
        : null;
    },
  });
}

export function useMarkHelpful() {
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (reviewId: string) => {
      if (!user) throw new Error("Sign in to vote.");
      const { error } = await supabase
        .from("review_helpfuls")
        .insert({ review_id: reviewId, user_id: user.id });
      // 23505 = already voted; treat as success.
      if (error && error.code !== "23505") throw error;
    },
  });
}

export function useReportReview() {
  return useMutation({
    mutationFn: async (reviewId: string) => {
      const { error } = await supabase.rpc("report_review", { _review_id: reviewId });
      if (error) throw error;
    },
  });
}

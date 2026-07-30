import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type GymReview = {
  id: string;
  reviewer_id: string;
  rating: number;
  title: string | null;
  body: string;
  verified: boolean;
  flagged: boolean;
  helpful_count: number;
  created_at: string;
  reviewer: {
    display_name: string;
    username: string | null;
    avatar_url: string | null;
    avatar_initials: string | null;
  } | null;
  helpful_by_me: boolean;
};

export type GymRatingSummary = {
  avg: number;
  count: number;
  /** index 0 = 1 star … index 4 = 5 stars */
  distribution: number[];
  verifiedCount: number;
};

export function summarizeGymReviews(list: GymReview[]): GymRatingSummary {
  const visible = list.filter((r) => !r.flagged);
  const count = visible.length;
  const distribution = [0, 0, 0, 0, 0];
  let sum = 0;
  for (const r of visible) {
    sum += r.rating;
    const i = Math.min(5, Math.max(1, Math.round(r.rating))) - 1;
    distribution[i] += 1;
  }
  return {
    avg: count ? sum / count : 0,
    count,
    distribution,
    verifiedCount: visible.filter((r) => r.verified).length,
  };
}

export const gymReviewsKey = (orgId: string, viewerId: string | null) => [
  "gym-reviews",
  orgId,
  viewerId,
];

async function fetchGymReviews(orgId: string, viewerId: string | null): Promise<GymReview[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select("id, reviewer_id, rating, title, body, verified, flagged, helpful_count, created_at")
    .eq("reviewee_kind", "gym")
    .eq("reviewee_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ids = Array.from(new Set(rows.map((r) => r.reviewer_id)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url, avatar_initials")
    .in("id", ids);
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  let helpfulIds = new Set<string>();
  if (viewerId) {
    const { data: votes } = await supabase
      .from("review_helpfuls")
      .select("review_id")
      .eq("user_id", viewerId)
      .in(
        "review_id",
        rows.map((r) => r.id),
      );
    helpfulIds = new Set((votes ?? []).map((v) => v.review_id));
  }

  return rows.map((r) => {
    const p = byId.get(r.reviewer_id);
    return {
      ...r,
      reviewer: p
        ? {
            display_name: p.display_name,
            username: p.username,
            avatar_url: p.avatar_url,
            avatar_initials: p.avatar_initials,
          }
        : null,
      helpful_by_me: helpfulIds.has(r.id),
    } as GymReview;
  });
}

export function useGymReviews(orgId: string) {
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  return useQuery({
    queryKey: gymReviewsKey(orgId, viewerId),
    queryFn: () => fetchGymReviews(orgId, viewerId),
    staleTime: 30_000,
  });
}

export function useGymReviewActions(orgId: string, orgName: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const viewerId = user?.id ?? null;
  const invalidate = () => qc.invalidateQueries({ queryKey: ["gym-reviews", orgId] });

  const submit = useMutation({
    mutationFn: async (input: { id?: string; rating: number; title: string; body: string }) => {
      if (!viewerId) throw new Error("Sign in to leave a review");
      const title = input.title.trim().slice(0, 120) || null;
      const body = input.body.trim();
      if (input.rating < 1 || input.rating > 5) throw new Error("Pick a star rating");
      if (body.length < 10) throw new Error("Review must be at least 10 characters");

      if (input.id) {
        const { error } = await supabase
          .from("reviews")
          .update({ rating: input.rating, title, body })
          .eq("id", input.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("reviews").insert({
        reviewer_id: viewerId,
        kind: "player",
        reviewee_kind: "gym",
        reviewee_id: orgId,
        reviewee_name: orgName,
        rating: input.rating,
        title,
        body,
      });
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          throw new Error("You already reviewed this gym — edit your review instead.");
        }
        throw error;
      }
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reviews").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const toggleHelpful = useMutation({
    mutationFn: async (r: GymReview) => {
      if (!viewerId) throw new Error("Sign in to vote");
      if (r.helpful_by_me) {
        const { error } = await supabase
          .from("review_helpfuls")
          .delete()
          .eq("review_id", r.id)
          .eq("user_id", viewerId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("review_helpfuls")
          .insert({ review_id: r.id, user_id: viewerId });
        if (error && !/duplicate/i.test(error.message)) throw error;
      }
    },
    onSuccess: invalidate,
  });

  const moderate = useMutation({
    mutationFn: async (input: { id: string; hidden: boolean }) => {
      const { error } = await supabase.rpc("moderate_gym_review", {
        _review_id: input.id,
        _hidden: input.hidden,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { submit, remove, toggleHelpful, moderate };
}

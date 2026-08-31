import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type ReportReason =
  | "spam"
  | "harassment"
  | "inappropriate"
  | "impersonation"
  | "safety"
  | "other";

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "impersonation", label: "Impersonation" },
  { value: "safety", label: "Safety concern" },
  { value: "other", label: "Something else" },
];

export async function blockUser(blockedId: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to block");
  if (u.user.id === blockedId) throw new Error("You cannot block yourself");
  const { error } = await supabase
    .from("user_blocks" as any)
    .insert({ blocker_id: u.user.id, blocked_id: blockedId } as any);
  if (error && !/duplicate/i.test(error.message)) throw error;
}

export async function unblockUser(blockedId: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to unblock");
  const { error } = await supabase
    .from("user_blocks" as any)
    .delete()
    .eq("blocker_id", u.user.id)
    .eq("blocked_id", blockedId);
  if (error) throw error;
}

export async function isBlocked(
  blockedId: string,
  viewerId: string | null,
): Promise<boolean> {
  if (!viewerId) return false;
  const { data, error } = await supabase
    .from("user_blocks" as any)
    .select("id")
    .eq("blocker_id", viewerId)
    .eq("blocked_id", blockedId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export function useBlock(targetId: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const viewerId = user?.id ?? null;
  const key = ["block", targetId, viewerId];

  const query = useQuery({
    queryKey: key,
    queryFn: () => isBlocked(targetId, viewerId),
    enabled: !!viewerId && !!targetId,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (query.data) await unblockUser(targetId);
      else await blockUser(targetId);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["block", targetId] });
      qc.invalidateQueries({ queryKey: ["follow", targetId] });
      qc.invalidateQueries({ queryKey: ["follow-list"] });
    },
  });

  return {
    blocked: !!query.data,
    loading: query.isLoading,
    pending: mutation.isPending,
    toggle: () => mutation.mutateAsync(),
  };
}

export async function reportUser(
  reportedId: string,
  reason: ReportReason,
  details?: string,
) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to report");
  if (u.user.id === reportedId) throw new Error("You cannot report yourself");
  const { error } = await supabase.from("user_reports" as any).insert({
    reporter_id: u.user.id,
    reported_id: reportedId,
    reason,
    details: details?.trim() || null,
  } as any);
  if (error) throw error;
}

export type ReelQualityIssue =
  | "blurry"
  | "wrong_game"
  | "not_a_highlight"
  | "duplicate"
  | "other";

export const REEL_QUALITY_ISSUES: { value: ReelQualityIssue; label: string }[] = [
  { value: "blurry", label: "Blurry, dark, or shaky footage" },
  { value: "wrong_game", label: "Wrong sport or wrong game" },
  { value: "not_a_highlight", label: "Not really a highlight" },
  { value: "duplicate", label: "Duplicate of another reel" },
  { value: "other", label: "Something else" },
];

/**
 * Flags a highlight reel as low quality. Reuses the moderation queue that
 * backs user reports, tagging the reel id in the details so reviewers can
 * jump straight to the clip.
 */
export async function flagReelQuality(
  reelId: string,
  authorId: string,
  issue: ReelQualityIssue,
  note?: string,
) {
  const label = REEL_QUALITY_ISSUES.find((i) => i.value === issue)?.label ?? issue;
  const details = [`Low-quality highlight reel ${reelId}`, label, note?.trim()]
    .filter(Boolean)
    .join(" — ");
  await reportUser(authorId, "inappropriate", details);
}

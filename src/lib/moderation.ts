import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type ReportReason =
  | "spam"
  | "harassment"
  | "inappropriate"
  | "impersonation"
  | "safety"
  | "other"
  | "threats"
  | "fake_account"
  | "scam"
  | "unsafe_behavior"
  | "minor_safety"
  | "fake_game"
  | "unsafe_location"
  | "misleading"
  | "illegal"
  | "payment_scam"
  | "payment_not_received"
  | "payment_pressure";

export type ReportSubjectType = "user" | "game" | "message" | "reel" | "payment";

type ReasonOption = { value: ReportReason; label: string };

export const USER_REPORT_REASONS: ReasonOption[] = [
  { value: "harassment", label: "Harassment" },
  { value: "threats", label: "Threatening behavior" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "fake_account", label: "Fake account" },
  { value: "impersonation", label: "Impersonation" },
  { value: "scam", label: "Scam or fraud" },
  { value: "unsafe_behavior", label: "Unsafe behavior" },
  { value: "minor_safety", label: "Inappropriate interaction with a minor" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
];

export const GAME_REPORT_REASONS: ReasonOption[] = [
  { value: "fake_game", label: "Fake game" },
  { value: "scam", label: "Scam" },
  { value: "unsafe_location", label: "Unsafe location" },
  { value: "misleading", label: "Misleading information" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "illegal", label: "Illegal activity" },
  { value: "other", label: "Other" },
];

export const MESSAGE_REPORT_REASONS: ReasonOption[] = [
  { value: "harassment", label: "Harassment" },
  { value: "threats", label: "Threatening behavior" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "scam", label: "Scam or fraud" },
  { value: "minor_safety", label: "Inappropriate interaction with a minor" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
];

export const PAYMENT_REPORT_REASONS: ReasonOption[] = [
  { value: "payment_scam", label: "Payment scam or fraud" },
  { value: "payment_not_received", label: "Host says they never received my payment" },
  { value: "payment_pressure", label: "Pressured to pay off-app or more than the fee" },
  { value: "impersonation", label: "Someone impersonating the host" },
  { value: "other", label: "Other" },
];

/** Back-compat alias used by older call sites. */
export const REPORT_REASONS = USER_REPORT_REASONS;

export function reasonsFor(subject: ReportSubjectType): ReasonOption[] {
  if (subject === "game") return GAME_REPORT_REASONS;
  if (subject === "message") return MESSAGE_REPORT_REASONS;
  if (subject === "payment") return PAYMENT_REPORT_REASONS;
  return USER_REPORT_REASONS;
}

const ALL_REASONS: ReasonOption[] = [
  ...USER_REPORT_REASONS,
  ...GAME_REPORT_REASONS,
  ...MESSAGE_REPORT_REASONS,
  ...PAYMENT_REPORT_REASONS,
];

export function reportReasonLabel(reason: string): string {
  return ALL_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

export const REPORT_STATUSES = [
  "new",
  "investigating",
  "resolved",
  "dismissed",
  "escalated",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export function reportStatusLabel(status: string): string {
  const map: Record<string, string> = {
    new: "New",
    pending: "New",
    open: "New",
    investigating: "Investigating",
    reviewing: "Investigating",
    resolved: "Resolved",
    actioned: "Resolved",
    dismissed: "Dismissed",
    escalated: "Escalated",
  };
  return map[status] ?? status;
}


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

export type SubmitReportInput = {
  subjectType: ReportSubjectType;
  /** The user the report is about (game host / message sender / reel owner). */
  reportedId: string;
  reason: ReportReason;
  details?: string;
  gameId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  reelId?: string | null;
};

/**
 * Files a moderation report. Reports are only visible to the reporter and to
 * moderators — never to the reported user.
 */
export async function submitReport(input: SubmitReportInput) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to report");
  if (u.user.id === input.reportedId) throw new Error("You cannot report yourself");
  const { error } = await supabase.from("user_reports").insert({
    reporter_id: u.user.id,
    reported_id: input.reportedId,
    subject_type: input.subjectType,
    reason: input.reason,
    details: input.details?.trim().slice(0, 1000) || null,
    game_id: input.gameId ?? null,
    conversation_id: input.conversationId ?? null,
    message_id: input.messageId ?? null,
    reel_id: input.reelId ?? null,
    status: "new",
  });
  if (error) throw error;
}

export async function reportUser(
  reportedId: string,
  reason: ReportReason,
  details?: string,
) {
  await submitReport({ subjectType: "user", reportedId, reason, details });
}

/** Ids of everyone the signed-in user has blocked, with profile details. */
export function useBlockedUsersList() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const viewerId = user?.id ?? null;

  const query = useQuery({
    queryKey: ["blocked-users", viewerId],
    enabled: !!viewerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_blocks")
        .select("blocked_id, created_at")
        .eq("blocker_id", viewerId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const ids = (data ?? []).map((r) => r.blocked_id);
      if (ids.length === 0) return [] as {
        id: string;
        displayName: string;
        username: string | null;
        avatarUrl: string | null;
        initials: string | null;
        blockedAt: string;
      }[];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url, avatar_initials")
        .in("id", ids);
      const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
      return (data ?? []).map((r) => {
        const p = byId.get(r.blocked_id);
        return {
          id: r.blocked_id,
          displayName: p?.display_name ?? "Blocked account",
          username: p?.username ?? null,
          avatarUrl: p?.avatar_url ?? null,
          initials: p?.avatar_initials ?? null,
          blockedAt: r.created_at,
        };
      });
    },
  });

  const unblock = useMutation({
    mutationFn: (id: string) => unblockUser(id),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["blocked-users"] });
      qc.invalidateQueries({ queryKey: ["block"] });
    },
  });

  return {
    users: query.data ?? [],
    loading: query.isLoading,
    unblock: (id: string) => unblock.mutateAsync(id),
    unblocking: unblock.isPending,
  };
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
  await submitReport({
    subjectType: "reel",
    reportedId: authorId,
    reason: "inappropriate",
    details,
    reelId,
  });

}

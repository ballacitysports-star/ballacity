import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getGamePaymentSettings,
  getMyJoinRequest,
  listMySubmissionsForGame,
  type GamePaymentSettings,
  type JoinRequest,
  type PaymentSubmission,
} from "@/lib/payments";

export type PlayerFlowStatus =
  | "none"
  | "requested"
  | "approved"
  | "payment_pending"
  | "payment_submitted"
  | "payment_rejected"
  | "payment_verified"
  | "confirmed"
  | "rejected";

export type FlowTone = "muted" | "info" | "warning" | "success" | "destructive";

export type FlowStepMeta = {
  label: string;
  short: string;
  tone: FlowTone;
  description: string;
};

export const FLOW_META: Record<PlayerFlowStatus, FlowStepMeta> = {
  none: {
    label: "Not joined",
    short: "Not joined",
    tone: "muted",
    description: "You haven't joined this game yet.",
  },
  requested: {
    label: "Requested",
    short: "Requested",
    tone: "muted",
    description: "Waiting for the host to review your request.",
  },
  approved: {
    label: "Approved",
    short: "Approved",
    tone: "info",
    description: "The host approved you — you're on the roster.",
  },
  payment_pending: {
    label: "Payment due",
    short: "Pay",
    tone: "warning",
    description: "Approved. Submit payment to lock your spot.",
  },
  payment_submitted: {
    label: "Awaiting review",
    short: "Review",
    tone: "info",
    description: "Payment sent. The host is reviewing your proof.",
  },
  payment_rejected: {
    label: "Payment declined",
    short: "Retry",
    tone: "destructive",
    description: "The host rejected your payment. Resubmit to keep your spot.",
  },
  payment_verified: {
    label: "Paid",
    short: "Paid",
    tone: "success",
    description: "Payment verified — you're confirmed.",
  },
  confirmed: {
    label: "Confirmed",
    short: "Confirmed",
    tone: "success",
    description: "You're on the roster. See you at the game!",
  },
  rejected: {
    label: "Not approved",
    short: "Declined",
    tone: "destructive",
    description: "The host declined your request.",
  },
};

export const FLOW_STEPS: PlayerFlowStatus[] = [
  "requested",
  "approved",
  "payment_pending",
  "payment_submitted",
  "payment_verified",
];

export function computePlayerFlowStatus(input: {
  joinRequest: JoinRequest | null;
  submissions: PaymentSubmission[];
  settings: GamePaymentSettings | null;
  isJoined: boolean;
}): PlayerFlowStatus {
  const { joinRequest, submissions, settings, isJoined } = input;
  // Host approval is the default: a game with no saved settings row is
  // treated as request-to-join.
  const requiresApproval = settings ? !!settings.requires_approval : true;
  const isPaid = !!settings && Number(settings.entry_fee ?? 0) > 0;
  const latest = submissions[0] ?? null;

  if (joinRequest?.status === "rejected") return "rejected";
  if (joinRequest?.status === "pending") return "requested";

  const approved = joinRequest?.status === "approved";

  if (isPaid) {
    if (latest?.status === "verified") return "payment_verified";
    if (latest?.status === "pending") return "payment_submitted";
    if (latest?.status === "rejected") return "payment_rejected";
    // No submission yet.
    if (requiresApproval && !approved) return "none";
    return "payment_pending";
  }

  if (requiresApproval) {
    return approved ? "confirmed" : "none";
  }

  return isJoined ? "confirmed" : "none";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(id: string | null | undefined): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

async function fetchFlowInputs(gameId: string, userId: string) {
  const [settings, joinRequest, submissions, isJoined] = await Promise.all([
    getGamePaymentSettings(gameId).catch(() => null),
    getMyJoinRequest(gameId).catch(() => null),
    listMySubmissionsForGame(gameId).catch(() => [] as PaymentSubmission[]),
    (async () => {
      try {
        const res = await supabase
          .from("game_participants")
          .select("user_id")
          .eq("game_id", gameId)
          .eq("user_id", userId)
          .maybeSingle();
        return !!res.data;
      } catch {
        return false;
      }
    })(),
  ]);
  return { settings, joinRequest, submissions, isJoined };
}

/**
 * Live-derived join → payment flow status for the signed-in viewer.
 * Refetches whenever a relevant realtime event fires on join_requests,
 * payment_submissions, or game_participants for this (game, user).
 */
export function useMyFlowStatus(gameId: string | undefined): {
  status: PlayerFlowStatus;
  loading: boolean;
  meta: FlowStepMeta;
  settings: GamePaymentSettings | null;
} {
  const [status, setStatus] = useState<PlayerFlowStatus>("none");
  const [settings, setSettings] = useState<GamePaymentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setUserId(data.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!cancelled) setUserId(session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!gameId || !userId || !isUuid(gameId)) {
      setStatus("none");
      setSettings(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const reload = async () => {
      const inputs = await fetchFlowInputs(gameId, userId);
      if (cancelled) return;
      setSettings(inputs.settings);
      setStatus(computePlayerFlowStatus(inputs));
      setLoading(false);
    };
    void reload();

    const chan = supabase
      .channel(`flow-status:${gameId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "join_requests",
          filter: `player_id=eq.${userId}`,
        },
        (p) => {
          const row = (p.new ?? p.old) as { game_id?: string };
          if (row?.game_id === gameId) void reload();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payment_submissions",
          filter: `player_id=eq.${userId}`,
        },
        (p) => {
          const row = (p.new ?? p.old) as { game_id?: string };
          if (row?.game_id === gameId) void reload();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_participants",
          filter: `user_id=eq.${userId}`,
        },
        (p) => {
          const row = (p.new ?? p.old) as { game_id?: string };
          if (row?.game_id === gameId) void reload();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      try {
        supabase.removeChannel(chan);
      } catch {
        /* ignore */
      }
    };
  }, [gameId, userId]);

  return { status, loading, meta: FLOW_META[status], settings };
}

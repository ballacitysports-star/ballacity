import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMyFlowStatus, isUuid, type PlayerFlowStatus } from "@/lib/game-flow-status";
import { cancelMyJoinRequest, withdrawMyApprovedJoinRequest } from "@/lib/payments";
import { leaveGame } from "@/lib/games-store";
import { isLateDrop, lateDropWarning } from "@/lib/late-drop";
import { supabase } from "@/integrations/supabase/client";

export type LeaveFlowVariant = "link" | "danger";

type Action = "cancel" | "withdraw" | "leave";

function actionFor(status: PlayerFlowStatus): Action | null {
  switch (status) {
    case "requested":
      return "cancel";
    case "approved":
    case "payment_pending":
    case "payment_submitted":
    case "payment_rejected":
      return "withdraw";
    case "confirmed":
    case "payment_verified":
      return "leave";
    default:
      return null;
  }
}

const COPY: Record<
  Action,
  {
    button: string;
    title: string;
    description: (t: string) => string;
    confirm: string;
    success: string;
    error: string;
  }
> = {
  cancel: {
    button: "Cancel request",
    title: "Cancel your request?",
    description: (t) => `Cancel your request to join ${t}? You can request again later.`,
    confirm: "Cancel request",
    success: "Request canceled.",
    error: "Could not cancel request.",
  },
  withdraw: {
    button: "Withdraw from game",
    title: "Withdraw from this game?",
    description: (t) =>
      `Withdraw from ${t}? Your spot will be released and any pending payment submission will be cleared. If you already paid, contact the host about refunds.`,
    confirm: "Withdraw",
    success: "You withdrew from the game.",
    error: "Could not withdraw.",
  },
  leave: {
    button: "Leave game",
    title: "Leave this game?",
    description: (t) =>
      `Leave ${t}? Your spot will be released. If you paid, contact the host about refunds.`,
    confirm: "Leave game",
    success: "You left the game.",
    error: "Could not leave the game.",
  },
};

async function clearPendingSubmissions(gameId: string) {
  try {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return;
    await supabase
      .from("payment_submissions")
      .delete()
      .eq("game_id", gameId)
      .eq("player_id", uid)
      .eq("status", "pending");
  } catch {
    /* best effort */
  }
}

export function LeaveFlowButton({
  gameId,
  gameTitle,
  variant = "link",
  navigateTo,
  onDone,
  className = "",
}: {
  gameId: string;
  gameTitle: string;
  variant?: LeaveFlowVariant;
  navigateTo?: string;
  onDone?: () => void;
  className?: string;
}) {
  const navigate = useNavigate();
  const { status } = useMyFlowStatus(isUuid(gameId) ? gameId : undefined);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const action = actionFor(status);
  // Only a player actually on the roster can late-drop; fetch the start time
  // when they open the confirmation rather than on every render.
  const { data: timing } = useQuery({
    queryKey: ["game-start", gameId],
    enabled: open && action === "leave" && isUuid(gameId),
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("hosted_games")
        .select("date, all_day")
        .eq("id", gameId)
        .maybeSingle();
      return data;
    },
  });
  if (!action) return null;
  const copy = COPY[action];
  const lateDrop =
    action === "leave" && !!timing && isLateDrop({ startsAt: timing.date, allDay: timing.all_day });

  const run = async () => {
    setBusy(true);
    try {
      if (action === "cancel") {
        await cancelMyJoinRequest(gameId);
      } else if (action === "withdraw") {
        await clearPendingSubmissions(gameId);
        await withdrawMyApprovedJoinRequest(gameId);
        leaveGame(gameId);
      } else {
        await withdrawMyApprovedJoinRequest(gameId).catch(() => {});
        leaveGame(gameId);
      }
      toast.success(copy.success);
      setOpen(false);
      onDone?.();
      if (navigateTo) {
        void navigate({ to: navigateTo });
      }
    } catch (e: any) {
      toast.error(e?.message ?? copy.error);
    } finally {
      setBusy(false);
    }
  };

  const trigger =
    variant === "danger" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-coral/40 bg-coral/10 py-3 text-sm font-bold text-coral transition-colors hover:bg-coral/20 ${className}`}
      >
        <LogOut className="h-4 w-4" /> {copy.button}
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 text-xs font-semibold text-coral underline-offset-2 hover:underline ${className}`}
      >
        <LogOut className="h-3.5 w-3.5" /> {copy.button}
      </button>
    );

  return (
    <>
      {trigger}
      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.title}</AlertDialogTitle>
            <AlertDialogDescription>{copy.description(gameTitle)}</AlertDialogDescription>
            {lateDrop && timing && (
              <p
                role="alert"
                className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px] leading-relaxed text-amber-600 dark:text-amber-400"
              >
                {lateDropWarning(timing.date)}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep my spot</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void run();
              }}
              className="bg-coral text-primary-foreground hover:bg-coral/90"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              {busy ? "Working…" : copy.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, XCircle, Info, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  cancelContactRequest,
  getExistingContactRequest,
  type ExistingRequestStatus,
  type ExistingRequestSummary,
} from "@/lib/availability";
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

type Props = {
  availabilityId: string;
  gameId?: string | null;
  /** Bump to force refetch after a successful send. */
  refreshKey?: number;
  onLoaded?: (summary: ExistingRequestSummary) => void;
  /** Fired after a successful cancel so parent can refresh its own state. */
  onCancelled?: () => void;
};

const STYLES: Record<
  ExistingRequestStatus,
  { label: string; sub: string; className: string; Icon: typeof Clock }
> = {
  none: {
    label: "No prior request",
    sub: "You haven't contacted this player yet.",
    className: "border-border bg-surface text-foreground",
    Icon: Info,
  },
  pending: {
    label: "Pending",
    sub: "Your request is waiting for a response.",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    Icon: Clock,
  },
  accepted: {
    label: "Accepted",
    sub: "This player already accepted a previous request.",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    Icon: CheckCircle2,
  },
  declined: {
    label: "Declined",
    sub: "A previous request was declined. You can send a new one.",
    className: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    Icon: XCircle,
  },
  withdrawn: {
    label: "Withdrawn",
    sub: "You withdrew a previous request. Feel free to send another.",
    className: "border-border bg-surface text-muted-foreground",
    Icon: Info,
  },
};

export function RequestStatusPanel({
  availabilityId,
  gameId,
  refreshKey,
  onLoaded,
  onCancelled,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ExistingRequestSummary | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getExistingContactRequest(availabilityId, { gameId: gameId ?? undefined })
      .then((s) => {
        if (!alive) return;
        setSummary(s);
        onLoaded?.(s);
      })
      .catch(
        () =>
          alive &&
          setSummary({ status: "none", kind: null, game_id: null, updated_at: null, id: null }),
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityId, gameId ?? "", refreshKey, localRefresh]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking request status…
      </div>
    );
  }

  const s = summary ?? { status: "none" as ExistingRequestStatus, updated_at: null, id: null };
  const cfg = STYLES[s.status];
  const Icon = cfg.Icon;
  const when = s.updated_at
    ? new Date(s.updated_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const handleCancel = async () => {
    if (!summary?.id) return;
    setCancelling(true);
    try {
      await cancelContactRequest(summary.id);
      toast.success("Request cancelled", {
        description: "You can send a new invite or contact request now.",
      });
      setLocalRefresh((k) => k + 1);
      onCancelled?.();
      setConfirmOpen(false);
    } catch (e: any) {
      toast.error("Couldn't cancel request", {
        description: e?.message ?? "Please try again in a moment.",
      });
    } finally {
      setCancelling(false);
    }
  };

  const isPending = s.status === "pending" && !!summary?.id;
  const kindLabel = summary?.kind === "invite" ? "invite" : "contact request";

  return (
    <>
      <div className={`flex items-start gap-2 rounded-2xl border p-3 ${cfg.className}`}>
        <Icon className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 text-xs">
          <p className="font-semibold">
            Status: {cfg.label}
            {when && s.status !== "none" ? (
              <span className="ml-1 font-normal opacity-80">· {when}</span>
            ) : null}
          </p>
          <p className="opacity-90 mt-0.5">{cfg.sub}</p>
          {isPending && (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={cancelling}
              className="mt-2 inline-flex items-center gap-1 rounded-full border border-current/40 bg-background/60 px-2.5 py-1 text-[11px] font-semibold hover:bg-background/90 disabled:opacity-60"
            >
              {cancelling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              {cancelling ? "Cancelling…" : "Cancel request"}
            </button>
          )}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !cancelling && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this pending {kindLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              The other player won't be notified. You can send a new {kindLabel} to them right
              after.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep request</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleCancel();
              }}
              disabled={cancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelling && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              {cancelling ? "Cancelling…" : `Cancel ${kindLabel}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

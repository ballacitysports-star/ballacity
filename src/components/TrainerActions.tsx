import { useEffect, useState } from "react";
import { authSearchHere } from "@/lib/pending-next";
import { useNavigate } from "@tanstack/react-router";
import {
  UserPlus,
  UserCheck,
  MessageCircle,
  CalendarClock,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { Org } from "@/lib/sample-data";
import { useFollow } from "@/lib/follows";
import { useAuth } from "@/hooks/use-auth";
import { BookSessionSheet } from "@/components/BookSessionSheet";
import {
  getMyPendingRequestForTrainer,
  subscribeToMyTrainerRequests,
  type TrainerSessionRequest,
} from "@/lib/trainer-requests";

function useMyTrainerRequest(trainerId: string) {
  const { user } = useAuth();
  const [row, setRow] = useState<TrainerSessionRequest | null>(null);

  const refresh = () => {
    if (!user) {
      setRow(null);
      return;
    }
    getMyPendingRequestForTrainer(trainerId)
      .then((r) => setRow(r && (r.status === "pending" || r.status === "accepted") ? r : null))
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
    if (!user) return;
    const unsub = subscribeToMyTrainerRequests(user.id, refresh);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, trainerId]);

  return { row, refresh };
}

export function TrainerActions({
  org,
  defaultVenue = null,
}: {
  org: Org;
  defaultVenue?: string | null;
}) {
  const nav = useNavigate();
  const { user } = useAuth();
  const { isFollowing, pending, toggle } = useFollow(org.id);
  const [bookOpen, setBookOpen] = useState(false);
  const { row, refresh } = useMyTrainerRequest(org.id);
  const venueOffered =
    !!defaultVenue &&
    (org.venueAddresses ?? []).some(
      (a) => a.trim().toLowerCase() === defaultVenue.trim().toLowerCase(),
    );
  const prefill = venueOffered ? { venue: defaultVenue } : null;

  const requireAuth = () => {
    if (!user) {
      toast("Sign in to continue");
      nav({ to: "/auth", search: authSearchHere() as never });
      return false;
    }
    return true;
  };

  const status = row?.status ?? null;
  const requestBtn = (() => {
    if (status === "pending") {
      return {
        cls: "bg-amber-500/15 border border-amber-500/50 text-amber-300",
        Icon: Clock,
        label: "Pending",
      };
    }
    if (status === "accepted") {
      return {
        cls: "bg-lime/15 border border-lime/50 text-lime",
        Icon: CheckCircle2,
        label: "Accepted",
      };
    }
    return {
      cls: "bg-lime-gradient text-primary-foreground glow-lime",
      Icon: CalendarClock,
      label: "Request",
    };
  })();

  return (
    <>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!requireAuth()) return;
            toggle();
          }}
          disabled={pending}
          className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-2 text-xs font-semibold transition-colors ${
            isFollowing
              ? "border-lime/60 bg-lime/10 text-lime"
              : "border-border bg-surface text-foreground hover:border-lime/50"
          } disabled:opacity-60`}
          aria-pressed={isFollowing}
          aria-label={isFollowing ? "Unfollow trainer" : "Follow trainer"}
        >
          {isFollowing ? (
            <UserCheck className="h-3.5 w-3.5" />
          ) : (
            <UserPlus className="h-3.5 w-3.5" />
          )}
          <span className="truncate">{isFollowing ? "Following" : "Follow"}</span>
        </button>

        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!requireAuth()) return;
            nav({ to: "/messages" });
          }}
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-2 text-xs font-semibold text-foreground hover:border-lime/50"
          aria-label={`Message ${org.name}`}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          <span className="truncate">Message</span>
        </button>

        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!requireAuth()) return;
            setBookOpen(true);
          }}
          className={`inline-flex items-center justify-center gap-1.5 rounded-full px-2.5 py-2 text-xs font-bold ${requestBtn.cls}`}
          aria-label={
            status === "pending"
              ? `Session request pending with ${org.name}`
              : status === "accepted"
                ? `Session accepted by ${org.name}`
                : `Request availability from ${org.name}`
          }
        >
          <requestBtn.Icon className={`h-3.5 w-3.5 ${status === "pending" ? "" : ""}`} />
          <span className="truncate">{requestBtn.label}</span>
        </button>
      </div>

      <BookSessionSheet
        org={org}
        open={bookOpen}
        onOpenChange={setBookOpen}
        onStatusChange={refresh}
        prefill={prefill}
      />
    </>
  );
}

// Re-export so trainer profile can render status/cancel without duplicate hook code
export { useMyTrainerRequest };

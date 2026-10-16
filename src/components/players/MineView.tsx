import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Inbox, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  deleteAvailability,
  listMyAvailabilities,
  listMyContactRequests,
  setContactRequestStatus,
  type AvailabilityContactRequest,
  type PlayerAvailability,
} from "@/lib/availability";
import { formatAvailabilityWindow } from "@/lib/availability-timeslots";
import { AvailabilityIntentBadges } from "./AvailabilityIntentBadges";
import { shareAvailability } from "./share-availability";

function LoadingRows() {
  return (
    <ul className="space-y-2">
      {[0, 1].map((i) => (
        <li key={i} className="h-20 animate-pulse rounded-2xl border border-border bg-surface/60" />
      ))}
    </ul>
  );
}

/** "Mine" view: your own availability posts plus incoming/outgoing requests. */
export function MineView({
  user,
  onEdit,
  refreshKey,
}: {
  user: { id: string } | null;
  onEdit: (m: PlayerAvailability) => void;
  refreshKey: number;
}) {
  const [mine, setMine] = useState<PlayerAvailability[] | null>(null);
  const [inbox, setInbox] = useState<AvailabilityContactRequest[] | null>(null);
  const [outbox, setOutbox] = useState<AvailabilityContactRequest[] | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      listMyAvailabilities().then(setMine),
      listMyContactRequests("inbox").then(setInbox),
      listMyContactRequests("outbox").then(setOutbox),
    ]).catch((e) => toast.error(e.message));
  }, [user?.id, refreshKey]);

  if (!user) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center">
        <Inbox className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="font-semibold">Sign in</p>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Sign in to manage your availability posts and contact requests.
        </p>
        <Link
          to="/auth"
          className="inline-flex rounded-full bg-lime-gradient px-5 py-2.5 text-sm font-bold text-primary-foreground"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const act = async (id: string, status: "accepted" | "declined") => {
    try {
      await setContactRequestStatus(id, status);
      setInbox((arr) => (arr ?? []).map((r) => (r.id === id ? { ...r, status } : r)));
      toast.success(status === "accepted" ? "Accepted" : "Declined");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Your posts
        </h2>
        {mine === null ? (
          <LoadingRows />
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">No posts yet.</p>
        ) : (
          <ul className="space-y-2">
            {mine.map((m) => (
              <li key={m.id} className="rounded-2xl border border-border bg-surface p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{m.sports.join(", ") || "Any sport"}</span>
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">
                    {m.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatAvailabilityWindow(m) || "No date set"} · {m.city || "Anywhere"}
                </p>
                <AvailabilityIntentBadges value={m.looking_for} className="mt-1" />
                <div className="mt-2 flex items-center gap-3">
                  <button onClick={() => onEdit(m)} className="text-xs font-semibold text-lime">
                    Edit
                  </button>
                  <button
                    onClick={() => shareAvailability(m.id)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"
                  >
                    <Share2 className="h-3 w-3" /> Share
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm("Remove this post?")) return;
                      await deleteAvailability(m.id);
                      setMine((arr) => (arr ?? []).filter((x) => x.id !== m.id));
                    }}
                    className="text-xs font-semibold text-coral"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Requests to you
        </h2>
        {inbox === null ? (
          <LoadingRows />
        ) : inbox.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet.</p>
        ) : (
          <ul className="space-y-2">
            {inbox.map((r) => (
              <li key={r.id} className="rounded-2xl border border-border bg-surface p-3 text-sm">
                <p className="text-xs text-muted-foreground">From a trainer/team</p>
                {r.message && <p className="mt-1">{r.message}</p>}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">
                    {r.status}
                  </span>
                  {r.status === "pending" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-full"
                        onClick={() => act(r.id, "declined")}
                      >
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 rounded-full bg-lime-gradient text-primary-foreground"
                        onClick={() => act(r.id, "accepted")}
                      >
                        Accept
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Requests you sent
        </h2>
        {outbox === null ? (
          <LoadingRows />
        ) : outbox.length === 0 ? (
          <p className="text-sm text-muted-foreground">No outgoing requests.</p>
        ) : (
          <ul className="space-y-2">
            {outbox.map((r) => (
              <li key={r.id} className="rounded-2xl border border-border bg-surface p-3 text-sm">
                {r.message && <p>{r.message}</p>}
                <span className="text-[10px] font-bold uppercase text-muted-foreground">
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

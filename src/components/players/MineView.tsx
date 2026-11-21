import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Inbox, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import {
  deleteAvailability,
  listMyAvailabilities,
  listMyContactRequests,
  reconfirmAvailability,
  setAvailabilityPaused,
  setContactRequestStatus,
  type AvailabilityContactRequest,
  type PlayerAvailability,
} from "@/lib/availability";
import { formatAvailabilityWindow } from "@/lib/availability-timeslots";
import { listingFor, type ListingState } from "@/lib/availability-lifecycle";
import { AvailabilityIntentBadges } from "./AvailabilityIntentBadges";
import { GameInvitationsSection } from "./GameInvitationsSection";
import { shareAvailability } from "./share-availability";
import { useAuthSearchHere } from "@/lib/auth-return";
import { userErrorMessage } from "@/lib/user-error";

function LoadingRows() {
  return (
    <ul className="space-y-2">
      {[0, 1].map((i) => (
        <li key={i} className="h-20 animate-pulse rounded-2xl border border-border bg-surface/60" />
      ))}
    </ul>
  );
}

/** A post's text actions (Pause, Edit, Share, Remove): small words, 44px tap targets. */
const POST_ACTION =
  "inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-xs font-semibold";

const STATE_CHIP: Record<ListingState, string> = {
  listed: "Listed",
  paused: "Paused",
  ended: "Not listed",
  closed: "Closed",
  guardian_closed: "Closed",
};

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
  const authSearch = useAuthSearchHere();
  const [mine, setMine] = useState<PlayerAvailability[] | null>(null);
  const [inbox, setInbox] = useState<AvailabilityContactRequest[] | null>(null);
  const [outbox, setOutbox] = useState<AvailabilityContactRequest[] | null>(null);
  // Which post a pause, resume or reconfirm is running on (declared before the early return: hooks run every render).
  const [busyId, setBusyId] = useState<string | null>(null);
  // "Remove" asks in an in-app dialog (WP 4.3); it stays open while the delete runs, and after a failure.
  const [removeTarget, setRemoveTarget] = useState<PlayerAvailability | null>(null);
  const [removing, setRemoving] = useState(false);
  // Where focus goes back to when the dialog closes: the Remove button that opened it, or, once that post is gone, the
  // list heading. The dialog is opened from state (one dialog for every post), so Radix has no trigger to return to.
  const removeOpenerRef = useRef<HTMLButtonElement | null>(null);
  const postsHeadingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      listMyAvailabilities().then(setMine),
      listMyContactRequests("inbox").then(setInbox),
      listMyContactRequests("outbox").then(setOutbox),
    ]).catch((e) =>
      toast.error(userErrorMessage(e, "Couldn't load your posts and requests. Please try again.")),
    );
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
          search={authSearch}
          className="inline-flex min-h-11 items-center rounded-full bg-lime-gradient px-5 py-2.5 text-sm font-bold text-primary-foreground"
        >
          Sign in
        </Link>
      </div>
    );
  }

  /** Pause, resume or reconfirm one post, then re-read it: the server sets status and last_confirmed_at. */
  const run = async (m: PlayerAvailability, change: () => Promise<void>, done: string) => {
    setBusyId(m.id);
    try {
      await change();
      setMine(await listMyAvailabilities());
      toast.success(done);
    } catch (e) {
      toast.error(userErrorMessage(e, "Couldn't update this post. Please try again."));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    const target = removeTarget;
    if (!target) return;
    setRemoving(true);
    try {
      await deleteAvailability(target.id);
      setMine((arr) => (arr ?? []).filter((x) => x.id !== target.id));
      setRemoveTarget(null);
      toast.success("Post removed");
    } catch (e) {
      toast.error(userErrorMessage(e, "Couldn't remove this post. Please try again."));
    } finally {
      setRemoving(false);
    }
  };

  const act = async (id: string, status: "accepted" | "declined") => {
    try {
      await setContactRequestStatus(id, status);
      setInbox((arr) => (arr ?? []).map((r) => (r.id === id ? { ...r, status } : r)));
      toast.success(status === "accepted" ? "Accepted" : "Declined");
    } catch (e: unknown) {
      toast.error(userErrorMessage(e, "Couldn't update this request. Please try again."));
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h2
          ref={postsHeadingRef}
          tabIndex={-1}
          className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground focus:outline-none"
        >
          Your posts
        </h2>
        {mine === null ? (
          <LoadingRows />
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">No posts yet.</p>
        ) : (
          <ul className="space-y-2">
            {mine.map((m) => {
              const listing = listingFor(m);
              const busy = busyId === m.id;
              return (
                <li
                  key={m.id}
                  data-testid="my-availability"
                  className="rounded-2xl border border-border bg-surface p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{m.sports.join(", ") || "Any sport"}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        listing.state === "listed" && !listing.needsAttention
                          ? "bg-lime/15 text-lime"
                          : listing.needsAttention
                            ? "bg-coral/15 text-coral"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {STATE_CHIP[listing.state]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatAvailabilityWindow(m) || "No date set"} · {m.city || "Anywhere"}
                  </p>
                  <p
                    className={`mt-1 text-xs font-medium ${listing.needsAttention ? "text-coral" : "text-muted-foreground"}`}
                  >
                    {listing.label}
                  </p>
                  <AvailabilityIntentBadges value={m.looking_for} className="mt-1" />
                  {listing.canReconfirm && (
                    <Button
                      size="sm"
                      className="mt-2 min-h-11 w-full"
                      disabled={busy}
                      onClick={() =>
                        run(
                          m,
                          () => reconfirmAvailability(m.id, m.status),
                          "Thanks, you're listed for 2 more weeks",
                        )
                      }
                    >
                      Still available
                    </Button>
                  )}
                  {/* Each action is a 44px tap target (WP 4.3); -mx-2 keeps the first word in line with the text above. */}
                  <div className="-mx-2 mt-1 flex flex-wrap items-center gap-x-1">
                    {(listing.state === "listed" || listing.state === "paused") && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          listing.state === "paused"
                            ? run(
                                m,
                                () => setAvailabilityPaused(m.id, false),
                                "Resumed: you're listed again",
                              )
                            : run(
                                m,
                                () => setAvailabilityPaused(m.id, true),
                                "Paused: nobody else sees this post",
                              )
                        }
                        className={`${POST_ACTION} text-foreground`}
                      >
                        {listing.state === "paused" ? "Resume" : "Pause"}
                      </button>
                    )}
                    <button onClick={() => onEdit(m)} className={`${POST_ACTION} text-lime`}>
                      {listing.state === "ended" && !listing.recurring ? "Pick new dates" : "Edit"}
                    </button>
                    <button
                      onClick={() => shareAvailability(m.id)}
                      className={`${POST_ACTION} gap-1 text-muted-foreground`}
                    >
                      <Share2 className="h-3 w-3" /> Share
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => {
                        removeOpenerRef.current = e.currentTarget;
                        setRemoveTarget(m);
                      }}
                      className={`${POST_ACTION} text-coral`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <AlertDialog
          open={!!removeTarget}
          onOpenChange={(o) => !removing && !o && setRemoveTarget(null)}
        >
          <AlertDialogContent
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              const opener = removeOpenerRef.current;
              removeOpenerRef.current = null;
              (opener?.isConnected ? opener : postsHeadingRef.current)?.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this post?</AlertDialogTitle>
              <AlertDialogDescription>
                It's deleted for good and nobody sees it anymore. You can post your availability
                again any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {/* aria-disabled, not disabled, while the delete runs: a disabled button drops focus out of the dialog. */}
              <AlertDialogCancel aria-disabled={removing || undefined}>Keep it</AlertDialogCancel>
              <AlertDialogAction
                aria-disabled={removing || undefined}
                onClick={(e) => {
                  // Stay open until the delete finishes; a failure keeps the dialog up with the toast.
                  e.preventDefault();
                  if (!removing) void remove();
                }}
                className="bg-destructive-strong text-destructive-foreground hover:bg-destructive-strong/90"
              >
                {removing ? "Removing…" : "Remove post"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>

      <GameInvitationsSection userId={user.id} refreshKey={refreshKey} />

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
                        className="min-h-11 rounded-full px-4"
                        onClick={() => act(r.id, "declined")}
                      >
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        className="min-h-11 rounded-full bg-lime-gradient px-4 text-primary-foreground"
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

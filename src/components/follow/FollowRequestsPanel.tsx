import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserAvatar } from "@/components/UserAvatar";
import { LoadingState } from "@/components/ui/loading-state";
import {
  listFollowRequests,
  listFollows,
  removeFollower,
  respondToFollowRequest,
  type FollowRequest,
  type FollowUser,
} from "@/lib/follows";

type Person = Pick<
  FollowUser,
  "id" | "display_name" | "username" | "avatar_url" | "avatar_initials"
>;

const approveClass =
  "h-8 rounded-full bg-lime-gradient px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60";
const quietClass =
  "h-8 rounded-full border border-border bg-surface px-4 text-xs font-semibold text-foreground hover:border-coral hover:text-coral disabled:opacity-60";

/**
 * Follow requests waiting for an account, and (for the account itself) its followers.
 *
 * Used for a person's own account and for a guardian reviewing a child's. The buttons
 * only call the database functions, which decide who may answer: the account itself
 * (unless under 16) or a verified guardian. Nothing here is the authorization.
 */
export function FollowRequestsPanel({
  targetUserId,
  showFollowers = false,
  who = "you",
}: {
  targetUserId: string;
  /** List current followers with a Remove button. Only the account itself can read them. */
  showFollowers?: boolean;
  /** How to refer to the account in empty states, e.g. "you" or a child's name. */
  who?: string;
}) {
  const qc = useQueryClient();

  const requests = useQuery({
    queryKey: ["follow-requests", targetUserId],
    queryFn: () => listFollowRequests(targetUserId),
  });
  const followers = useQuery({
    queryKey: ["follow-list", targetUserId, "followers", "manage"],
    enabled: showFollowers,
    queryFn: () => listFollows(targetUserId, "followers", null, 100, targetUserId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["follow-requests", targetUserId] });
    void qc.invalidateQueries({ queryKey: ["follow-list"] });
    void qc.invalidateQueries({ queryKey: ["follow", targetUserId] });
  };

  const respond = useMutation({
    mutationFn: (v: { requesterId: string; approve: boolean }) =>
      respondToFollowRequest(v.requesterId, targetUserId, v.approve),
    onSuccess: (_d, v) => toast.success(v.approve ? "Request approved" : "Request declined"),
    onError: (e: Error) => toast.error(e.message),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (followerId: string) => removeFollower(targetUserId, followerId),
    onSuccess: () => toast.success("Follower removed"),
    onError: (e: Error) => toast.error(e.message),
    onSettled: refresh,
  });

  const waiting = requests.data ?? [];
  const busy = respond.isPending || remove.isPending;

  return (
    <div className="space-y-6">
      <section aria-labelledby={`follow-requests-${targetUserId}`}>
        <h2 id={`follow-requests-${targetUserId}`} className="px-1 text-sm font-semibold">
          Follow requests{waiting.length > 0 ? ` (${waiting.length})` : ""}
        </h2>
        {requests.isLoading ? (
          <LoadingState label="Loading requests…" />
        ) : requests.isError ? (
          <p className="px-1 py-3 text-sm text-muted-foreground">Couldn&apos;t load requests.</p>
        ) : waiting.length === 0 ? (
          <p className="px-1 py-3 text-sm text-muted-foreground">
            No one is waiting to follow {who}.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-border">
            {waiting.map((r: FollowRequest) => (
              <PersonRow key={r.id} person={r}>
                <button
                  type="button"
                  className={approveClass}
                  disabled={busy}
                  onClick={() => respond.mutate({ requesterId: r.id, approve: true })}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className={quietClass}
                  disabled={busy}
                  onClick={() => respond.mutate({ requesterId: r.id, approve: false })}
                >
                  Decline
                </button>
              </PersonRow>
            ))}
          </ul>
        )}
      </section>

      {showFollowers ? (
        <section aria-labelledby={`followers-${targetUserId}`}>
          <h2 id={`followers-${targetUserId}`} className="px-1 text-sm font-semibold">
            Followers
          </h2>
          {followers.isLoading ? (
            <LoadingState label="Loading followers…" />
          ) : followers.isError ? (
            <p className="px-1 py-3 text-sm text-muted-foreground">Couldn&apos;t load followers.</p>
          ) : (followers.data?.users ?? []).length === 0 ? (
            <p className="px-1 py-3 text-sm text-muted-foreground">No followers yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-border">
              {(followers.data?.users ?? []).map((f) => (
                <PersonRow key={f.id} person={f}>
                  <button
                    type="button"
                    className={quietClass}
                    disabled={busy}
                    onClick={() => remove.mutate(f.id)}
                  >
                    Remove
                  </button>
                </PersonRow>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function PersonRow({ person, children }: { person: Person; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Link
        to="/players/$userId"
        params={{ userId: person.id }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <UserAvatar
          avatarUrl={person.avatar_url}
          initials={person.avatar_initials}
          name={person.display_name}
          size="md"
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{person.display_name}</span>
          {person.username ? (
            <span className="block truncate text-xs text-muted-foreground">@{person.username}</span>
          ) : null}
        </span>
      </Link>
      <div className="flex shrink-0 gap-2">{children}</div>
    </li>
  );
}

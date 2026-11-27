import { Link } from "@tanstack/react-router";
import { AUDIENCE_LABELS, type PostAudience } from "@/lib/network-posts-rules";
import type { ModerationPost } from "@/lib/moderation.functions";

/** Where a post stands, in the queue's words: what a moderator needs before choosing Remove content or Restore. */
export function reportedPostState(post: ModerationPost): string | null {
  const notes = [
    post.hidden ? "hidden" : null,
    post.deleted ? "deleted by its author" : null,
    post.moderationStatus === "pending" ? "waiting for its check" : null,
    post.moderationStatus === "held" ? "held by the screen" : null,
  ].filter(Boolean);
  return notes.length ? notes.join(", ") : null;
}

/**
 * The reported network post on a moderation queue card (subject 'post', 20261205100000): its text, who could read it,
 * where it stands, and a link to the team or venue it was posted as. The reported user (its author) is linked on the
 * card already. The text is read with the service role, so a moderator sees it whatever its audience.
 */
export function ReportedPostEvidence({
  postId,
  post,
}: {
  postId: string | null;
  post: ModerationPost | null;
}) {
  if (!post) {
    return (
      <div className="sm:col-span-2">
        <dt className="text-muted-foreground">Network post</dt>
        <dd className="rounded-lg border border-border bg-surface p-2">
          {postId ? "(post not found)" : "(the author deleted this post for good)"}
        </dd>
      </div>
    );
  }
  const audience = AUDIENCE_LABELS[post.audience as PostAudience]?.label ?? post.audience;
  const state = reportedPostState(post);
  return (
    <div className="sm:col-span-2">
      <dt className="text-muted-foreground">Network post</dt>
      <dd className="space-y-1">
        <p className="rounded-lg border border-border bg-surface p-2 whitespace-pre-wrap">
          {post.body}
        </p>
        <p className="text-muted-foreground">
          Shared with: {audience}
          {state ? ` · ${state}` : ""}
          {post.postedAs === "team" && post.teamId ? (
            <>
              {" · "}
              <Link to="/teams/$teamId" params={{ teamId: post.teamId }} className="underline">
                Posted as a team
              </Link>
            </>
          ) : null}
          {post.postedAs === "org" && post.orgId ? (
            <>
              {" · "}
              <Link to="/orgs/$orgId" params={{ orgId: post.orgId }} className="underline">
                Posted as a venue
              </Link>
            </>
          ) : null}
        </p>
      </dd>
    </div>
  );
}

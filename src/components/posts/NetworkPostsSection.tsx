import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useMyAge } from "@/lib/use-my-age";
import { cohortFromAge } from "@/lib/child-policy";
import { useMyTeamMemberships } from "@/lib/team-roster";
import { formatWhen } from "@/lib/format";
import { heldNotice } from "@/lib/post-moderation";
import {
  AUDIENCE_LABELS,
  FEED_PAGE_SIZE,
  audiencesForCohort,
  deletePost,
  listFeedPosts,
  listFollowingPosts,
  postErrorMessage,
  useNetworkPostsEnabled,
  type FeedPost,
  type PostAudience,
} from "@/lib/network-posts";
import { createNetworkPost } from "@/lib/network-posts.functions";
import { HighlightsStrip } from "@/components/reels/HighlightsStrip";

const FEED_KEY = ["network-posts-feed"];

type FeedView = "all" | "following";

/**
 * Posts on Home (P1-2). Renders nothing unless the network_posts flag is on and someone
 * is signed in. The composer offers only the audiences this account may use; the
 * database enforces the same rules and decides who reads each post.
 */
export function NetworkPostsSection() {
  const enabled = useNetworkPostsEnabled();
  const { user } = useAuth();
  if (!enabled || !user) return null;
  return (
    <section aria-labelledby="network-posts-title" className="space-y-3 px-4 pt-3">
      <h2 id="network-posts-title" className="text-base font-bold">
        Posts
      </h2>
      <PostComposer />
      <FeedTabs viewerId={user.id} />
    </section>
  );
}

export function PostComposer() {
  const qc = useQueryClient();
  const { age, loading } = useMyAge();
  const teams = useMyTeamMemberships();
  const create = useServerFn(createNetworkPost);
  const allowed = audiencesForCohort(cohortFromAge(age));
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<PostAudience | null>(null);
  const [teamId, setTeamId] = useState<string>("");

  const myTeams = teams.data ?? [];
  const options = allowed.filter((a) => a !== "team" || myTeams.length > 0);
  const chosen = audience && options.includes(audience) ? audience : (options[0] ?? null);
  const chosenTeam = teamId || myTeams[0]?.teamId || "";

  const post = useMutation({
    mutationFn: () =>
      create({
        data: {
          audience: chosen as PostAudience,
          body: body.trim(),
          teamId: chosen === "team" ? chosenTeam : null,
        },
      }),
    onSuccess: (res) => {
      setBody("");
      const held = heldNotice(res);
      if (held) toast.message(held);
      else toast.success("Posted");
      qc.invalidateQueries({ queryKey: FEED_KEY });
    },
    onError: (e) => toast.error(postErrorMessage(e instanceof Error ? e.message : String(e))),
  });

  if (loading) return null;
  if (options.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
        Posting isn't available for your account.
      </p>
    );
  }

  return (
    <form
      className="space-y-2 rounded-xl border border-border bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim() && chosen) post.mutate();
      }}
    >
      <label htmlFor="new-post-body" className="sr-only">
        Write a post
      </label>
      <textarea
        id="new-post-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="Share an update"
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="new-post-audience" className="text-xs text-muted-foreground">
          Who sees it
        </label>
        <select
          id="new-post-audience"
          value={chosen ?? ""}
          onChange={(e) => setAudience(e.target.value as PostAudience)}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
        >
          {options.map((a) => (
            <option key={a} value={a}>
              {AUDIENCE_LABELS[a].label}
            </option>
          ))}
        </select>
        {chosen === "team" && (
          <>
            <label htmlFor="new-post-team" className="sr-only">
              Team
            </label>
            <select
              id="new-post-team"
              value={chosenTeam}
              onChange={(e) => setTeamId(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
            >
              {myTeams.map((t) => (
                <option key={t.teamId} value={t.teamId}>
                  {t.name}
                </option>
              ))}
            </select>
          </>
        )}
        <button
          type="submit"
          disabled={!body.trim() || post.isPending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-lime-gradient px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-60"
        >
          {post.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Post
        </button>
      </div>
      {chosen && (
        <p className="text-[11px] text-muted-foreground">{AUDIENCE_LABELS[chosen].description}</p>
      )}
    </form>
  );
}

function FeedTabs({ viewerId }: { viewerId: string }) {
  const [view, setView] = useState<FeedView>("all");
  const tabs: Array<{ key: FeedView; label: string }> = [
    { key: "all", label: "All" },
    { key: "following", label: "Following" },
  ];
  return (
    <div className="space-y-2">
      <div role="tablist" aria-label="Which posts" className="flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={view === t.key}
            onClick={() => setView(t.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
              view === t.key ? "bg-foreground text-background" : "border border-border"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* P3-2: reels in Home and Following, gated exactly as the public highlight feed. */}
      <HighlightsStrip
        key={view}
        following={view === "following"}
        heading={view === "following" ? "Highlights from people you follow" : "Latest highlights"}
      />
      <PostList viewerId={viewerId} view={view} />
    </div>
  );
}

function PostList({ viewerId, view }: { viewerId: string; view: FeedView }) {
  const qc = useQueryClient();
  const feed = useInfiniteQuery({
    queryKey: [...FEED_KEY, view],
    queryFn: ({ pageParam }) =>
      view === "following" ? listFollowingPosts(pageParam) : listFeedPosts(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.length === FEED_PAGE_SIZE ? last[last.length - 1].createdAt : undefined,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deletePost(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: FEED_KEY }),
    onError: (e) => toast.error(postErrorMessage(e instanceof Error ? e.message : String(e))),
  });

  const posts = (feed.data?.pages ?? []).flat();
  if (feed.isLoading)
    return <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-label="Loading posts" />;
  if (feed.isError) return <p className="text-sm text-muted-foreground">Posts couldn't load.</p>;
  if (posts.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {view === "following"
          ? "Nothing yet from people, teams or venues you follow."
          : "No posts yet. Share the first one."}
      </p>
    );

  return (
    <ul className="space-y-2">
      {posts.map((p) => (
        <PostItem
          key={p.id}
          post={p}
          mine={p.authorId === viewerId}
          onDelete={() => remove.mutate(p.id)}
        />
      ))}
      {feed.hasNextPage && (
        <li>
          <button
            type="button"
            onClick={() => feed.fetchNextPage()}
            disabled={feed.isFetchingNextPage}
            className="w-full rounded-lg border border-border py-2 text-sm font-semibold"
          >
            {feed.isFetchingNextPage ? "Loading…" : "Show more"}
          </button>
        </li>
      )}
    </ul>
  );
}

export function PostItem({
  post,
  mine,
  onDelete,
}: {
  post: FeedPost;
  mine: boolean;
  onDelete: () => void;
}) {
  return (
    <li className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-semibold">{post.authorName}</span>
        <span className="text-[11px] text-muted-foreground">
          {formatWhen(post.createdAt)} · {AUDIENCE_LABELS[post.audience].label}
        </span>
        {mine && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete post"
            className="ml-auto grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-coral"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {mine && post.moderationStatus !== "approved" && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Only you can see this until it's reviewed.
        </p>
      )}
      <p className="mt-1 whitespace-pre-wrap text-sm">{post.body}</p>
    </li>
  );
}

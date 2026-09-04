import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpDown,
  Clapperboard,
  Loader2,
  MapPin,
  MessageCircle,
  PlusSquare,
  Send,
} from "lucide-react";

import { pageHead } from "@/lib/seo";
import { InlineVideoPlayer } from "@/components/InlineVideoPlayer";
import { FollowButton } from "@/components/FollowButton";
import { PostEngagement } from "@/components/PostEngagement";
import { FlagReelButton } from "@/components/FlagReelButton";
import {
  listHighlightFeed,
  listHighlightFeedSports,
  type HighlightFeedItem,
} from "@/lib/highlight-feed.functions";
import { useReelRealtime } from "@/hooks/use-reel-realtime";


export const Route = createFileRoute("/highlights")({
  head: () =>
    pageHead({
      path: "/highlights",
      title: "Highlight feed — ballaCity",
      description:
        "Scroll the latest player highlight reels on ballaCity: basketball, soccer, and every other pickup sport, linked to the games they came from.",
      ogType: "website",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "ballaCity highlight feed",
      },
    }),
  component: HighlightFeedPage,
});

function HighlightFeedPage() {
  const [items, setItems] = useState<HighlightFeedItem[]>([]);
  const [sports, setSports] = useState<string[]>([]);
  const [sport, setSport] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("newest");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listHighlightFeedSports()
      .then((s) => {
        if (!cancelled) setSports(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // First page (and every filter change) resets the scroll list.
  const loadFirstPage = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      return listHighlightFeed({ data: { sport, cursor: null } })
        .then((res) => {
          setItems((prev) => {
            if (!opts?.silent) return res.items;
            // Merge: keep already-loaded older pages, refresh/prepend the newest.
            const fresh = new Map(res.items.map((r) => [r.id, r]));
            const rest = prev.filter((r) => !fresh.has(r.id));
            return [...res.items, ...rest];
          });
          if (!opts?.silent) {
            setCursor(res.nextCursor);
            setDone(!res.nextCursor);
          }
        })
        .catch((e: unknown) => {
          if (!opts?.silent) setError(e instanceof Error ? e.message : "Couldn't load the feed");
        })
        .finally(() => {
          if (!opts?.silent) setLoading(false);
        });
    },
    [sport],
  );

  useEffect(() => {
    setDone(false);
    void loadFirstPage();
  }, [loadFirstPage]);

  // New reels (and reels that just finished processing) show up live.
  useReelRealtime(() => {
    void loadFirstPage({ silent: true });
    void listHighlightFeedSports()
      .then(setSports)
      .catch(() => {});
  });


  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || done) return;
    setLoadingMore(true);
    try {
      const res = await listHighlightFeed({ data: { sport, cursor } });
      setItems((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...res.items.filter((r) => !seen.has(r.id))];
      });
      setCursor(res.nextCursor);
      if (!res.nextCursor) setDone(true);
    } catch {
      setDone(true);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, done, loadingMore, sport]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [loadMore]);

  const visible = sortItems(items, sort);

  return (
    <div className="min-h-dvh bg-background pb-24 pt-[env(safe-area-inset-top)]">
      {/* Instagram-style top bar: wordmark left, actions right. */}
      <header className="sticky top-0 z-10 border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[470px] items-center gap-3 px-4 py-3">
          <Link to="/" className="shrink-0 text-muted-foreground" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="flex-1 truncate text-xl font-black tracking-tight">Highlights</h1>
          <Link
            to="/reels"
            search={{ game: "", title: "", upload: "" }}
            className="shrink-0 text-foreground"
            aria-label="Post a reel"
          >
            <PlusSquare className="h-6 w-6" />
          </Link>
          <button
            type="button"
            onClick={() => setSort((s) => (s === "newest" ? "oldest" : s === "oldest" ? "sport" : "newest"))}
            className="shrink-0 text-muted-foreground"
            aria-label={`Sort: ${SORT_LABEL[sort]}`}
            title={`Sort: ${SORT_LABEL[sort]}`}
          >
            <ArrowUpDown className="h-5 w-5" />
          </button>
        </div>

        {/* Stories rail — one ring per sport, doubling as the filter. */}
        <div className="mx-auto flex w-full max-w-[470px] gap-4 overflow-x-auto px-4 pb-3">
          <StoryRing active={!sport} onClick={() => setSport(null)} label="All" />
          {sports.map((s) => (
            <StoryRing key={s} active={sport === s} onClick={() => setSport(s)} label={s} />
          ))}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[470px]">
        {loading ? (
          <div className="grid place-items-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">{error}</p>
        ) : items.length === 0 ? (
          <div className="mx-4 mt-6 rounded-2xl border border-dashed border-border p-8 text-center">
            <Clapperboard className="mx-auto h-6 w-6 text-lime" />
            <p className="mt-2 text-sm font-semibold">No highlights here yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {sport ? "Try another sport, or be the first to post one." : "Be the first to post one."}
            </p>
            <Link
              to="/reels"
              search={{ game: "", title: "", upload: "" }}
              className="mt-3 inline-block text-xs font-bold text-lime underline"
            >
              Create a highlight reel
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {visible.map((item) => (
              <FeedReelCard key={item.id} item={item} />
            ))}
          </ul>
        )}

        <div ref={sentinel} aria-hidden className="h-px" />
        {loadingMore && (
          <div className="grid place-items-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {done && items.length > 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">You&apos;re all caught up.</p>
        )}
      </main>
    </div>
  );
}

const SORT_LABEL: Record<SortMode, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  sport: "Sport A–Z",
};

/** Circular story bubble used as the sport filter, Instagram-style. */
function StoryRing({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-16 shrink-0 flex-col items-center gap-1">
      <span
        className={`grid h-16 w-16 place-items-center rounded-full p-[2px] ${
          active
            ? "bg-gradient-to-tr from-lime via-lime/70 to-primary"
            : "bg-border"
        }`}
      >
        <span className="grid h-full w-full place-items-center rounded-full bg-background">
          <span className="grid h-[calc(100%-4px)] w-[calc(100%-4px)] place-items-center rounded-full bg-surface text-sm font-black uppercase text-foreground">
            {label.slice(0, 2)}
          </span>
        </span>
      </span>
      <span className="w-full truncate text-center text-[11px] capitalize text-muted-foreground">
        {label}
      </span>
    </button>
  );
}


type SortMode = "newest" | "oldest" | "sport";

/** Client-side ordering for the reels already loaded into the scroll list. */
function sortItems(items: HighlightFeedItem[], mode: SortMode): HighlightFeedItem[] {
  const copy = [...items];
  if (mode === "oldest") {
    return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  if (mode === "sport") {
    return copy.sort(
      (a, b) =>
        (a.sport ?? "zzz").localeCompare(b.sport ?? "zzz") ||
        b.createdAt.localeCompare(a.createdAt),
    );
  }
  return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function FeedReelCard({ item }: { item: HighlightFeedItem }) {
  const [showComments, setShowComments] = useState(false);
  const gameDate = item.game?.date ? new Date(item.game.date) : null;
  return (
    <li className="bg-background pb-3">
      {/* Post header: avatar with story ring, name, sport/time, follow */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Link
          to="/players/$userId"
          params={{ userId: item.author.id }}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-tr from-lime via-lime/70 to-primary p-[2px]"
        >
          <span className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-surface text-[10px] font-bold text-lime">
            {item.author.avatarUrl ? (
              <img
                src={item.author.avatarUrl}
                alt={`${item.author.displayName} avatar`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              (item.author.initials ?? item.author.displayName.slice(0, 2).toUpperCase())
            )}
          </span>
        </Link>
        <div className="min-w-0 flex-1 leading-tight">
          <Link
            to="/players/$userId"
            params={{ userId: item.author.id }}
            className="block truncate text-[13px] font-semibold hover:underline"
          >
            {item.author.displayName}
          </Link>
          {item.sport && (
            <p className="truncate text-[11px] capitalize text-muted-foreground">{item.sport}</p>
          )}
        </div>
        <FollowButton userId={item.author.id} size="sm" />
        <FlagReelButton reelId={item.id} authorId={item.author.id} />
      </div>

      {/* Full-bleed 4:5 media, the Instagram portrait frame */}
      <div className="[&_.aspect-video]:aspect-[4/5] [&_.rounded-lg]:rounded-none">
        <InlineVideoPlayer
          videoUrl={item.videoUrl}
          fallbackVideoUrl={item.fallbackVideoUrl}
          thumbnailUrl={item.thumbnailUrl}
          ariaLabel={`Highlight reel: ${item.title}`}
        />
      </div>

      {/* Action row */}
      <div className="flex items-center gap-4 px-3 pt-3">
        <button
          type="button"
          onClick={() => setShowComments((v) => !v)}
          aria-expanded={showComments}
          aria-label={showComments ? "Hide comments" : "Show comments"}
          className="text-foreground"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
        <Link
          to="/players/$userId"
          params={{ userId: item.author.id }}
          className="text-foreground"
          aria-label={`View ${item.author.displayName}'s profile`}
        >
          <Send className="h-6 w-6 -rotate-12" />
        </Link>
      </div>

      {/* Caption block */}
      <div className="space-y-1 px-3 pt-2">
        <p className="text-sm">
          <Link
            to="/players/$userId"
            params={{ userId: item.author.id }}
            className="font-semibold hover:underline"
          >
            {item.author.displayName}
          </Link>{" "}
          <span className="font-medium">{item.title}</span>
        </p>
        {item.caption && <p className="text-sm text-muted-foreground">{item.caption}</p>}
        {item.hashtags.length > 0 && (
          <p className="text-sm font-medium text-lime">
            {item.hashtags.map((h) => `#${h}`).join(" ")}
          </p>
        )}
        {item.game && (
          <Link
            to="/games/$gameId"
            params={{ gameId: item.game.id }}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-muted-foreground"
          >
            <MapPin className="h-3 w-3" />
            <span className="font-semibold text-foreground">{item.game.title}</span>
            {gameDate && (
              <span>
                {gameDate.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
            {item.game.location && <span className="truncate">{item.game.location}</span>}
          </Link>
        )}
        {!showComments && (
          <button
            type="button"
            onClick={() => setShowComments(true)}
            className="pt-0.5 text-sm text-muted-foreground"
          >
            View comments
          </button>
        )}
        <p className="pt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {relativeTime(item.createdAt)}
        </p>
        {showComments && (
          <div className="pt-1">
            <PostEngagement subjectType="highlight_reel" subjectId={item.id} />
          </div>
        )}
      </div>
    </li>
  );
}


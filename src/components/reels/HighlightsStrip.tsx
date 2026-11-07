import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Film } from "lucide-react";
import { listHighlightFeed, type HighlightFeedItem } from "@/lib/highlight-feed.functions";

/**
 * Reels in Home and Following (P3-2): a short row of recent highlight reels.
 *
 * It reuses the public highlight feed, so every rule stays in one place: the age-cohort
 * and audience gate in SQL, quarantined media never signed, links to a game only when
 * the game is public. `following` keeps the reels by people the viewer follows.
 * Renders nothing while loading, on error or when there is nothing to show.
 */
export function HighlightsStrip({
  following = false,
  heading,
  limit = 6,
}: {
  following?: boolean;
  heading: string;
  limit?: number;
}) {
  const list = useServerFn(listHighlightFeed);
  const q = useQuery({
    queryKey: ["highlights-strip", following ? "following" : "all", limit],
    queryFn: () => list({ data: { limit, following } }),
    staleTime: 60_000,
  });
  const items: HighlightFeedItem[] = q.data?.items ?? [];
  if (q.isLoading || q.isError || items.length === 0) return null;

  return (
    <section aria-label={heading} className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="section-eyebrow text-muted-foreground">{heading}</h3>
        {!following && (
          <Link to="/highlights" className="text-xs font-semibold text-lime">
            See all
          </Link>
        )}
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {items.map((r) => (
          <li key={r.id} className="w-28 shrink-0">
            <Link to="/reels/$reelId" params={{ reelId: r.id }} className="block">
              <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-border bg-surface">
                {r.thumbnailUrl ? (
                  <img
                    src={r.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-muted-foreground">
                    <Film className="h-6 w-6" aria-hidden />
                  </div>
                )}
              </div>
              <div className="mt-1 truncate text-xs font-semibold">{r.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {r.author.displayName}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

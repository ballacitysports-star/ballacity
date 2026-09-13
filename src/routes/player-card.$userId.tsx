import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Calendar, Clapperboard, MapPin, BarChart3, ExternalLink } from "lucide-react";
import { pageHead, ogImageUrl } from "@/lib/seo";
import { InlineVideoPlayer } from "@/components/InlineVideoPlayer";
import { listPublicReels } from "@/lib/reels.functions";
import { getPlayerCard, type PlayerCardData } from "@/lib/player-card.functions";
import { useReelRealtime } from "@/hooks/use-reel-realtime";

export const Route = createFileRoute("/player-card/$userId")({
  head: ({ params }) => ({
    ...pageHead({
      path: `/player-card/${params.userId}`,
      title: "Player card — highlights, games & stats | BallaCity",
      description:
        "A mobile player card with this athlete's highlight reels, recent and upcoming games, and season stats.",
      ogType: "profile",
      image: ogImageUrl({
        kind: "player",
        title: "Player card",
        subtitle: "Highlights, games and stats",
        meta: ["BallaCity player"],
      }),
    }),
  }),
  component: PlayerCardPage,
});

type PublicReel = {
  id: string;
  title: string;
  videoUrl: string | null;
  fallbackVideoUrl?: string | null;
  thumbnailUrl: string | null;
  sport: string | null;
  caption: string | null;
  gameTitle: string | null;
  createdAt: string;
};

const SECTIONS = [
  { id: "highlights", label: "Highlights", icon: Clapperboard },
  { id: "games", label: "Games", icon: Calendar },
  { id: "stats", label: "Stats", icon: BarChart3 },
] as const;

function formatGameDate(iso: string | null) {
  if (!iso) return "Date TBD";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date TBD";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function PlayerCardPage() {
  const { userId } = Route.useParams();
  const [card, setCard] = useState<PlayerCardData | null>(null);
  const [reels, setReels] = useState<PublicReel[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string>("highlights");
  const refs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getPlayerCard({ data: { userId } }).catch(() => null),
      listPublicReels({ data: { userId } }).catch(() => []),
    ]).then(([c, r]) => {
      if (cancelled) return;
      setCard(c as PlayerCardData | null);
      setReels((r as PublicReel[]) ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Live-update when this player publishes (or finishes processing) a reel.
  useReelRealtime(
    () => {
      void listPublicReels({ data: { userId } })
        .then((r) => setReels((r as PublicReel[]) ?? []))
        .catch(() => {});
    },
    { userId },
  );

  // Highlight the tab for whichever section is in view while scrolling.
  useEffect(() => {
    if (loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-96px 0px -55% 0px", threshold: [0.1, 0.5, 1] },
    );
    SECTIONS.forEach((s) => {
      const el = refs.current[s.id];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [loading]);

  const now = Date.now();
  const { upcoming, past } = useMemo(() => {
    const games = card?.games ?? [];
    return {
      upcoming: games
        .filter((g) => new Date(g.date ?? 0).getTime() > now)
        .sort((a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime()),
      past: games.filter((g) => new Date(g.date ?? 0).getTime() <= now),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  const scrollTo = (id: string) => {
    setActive(id);
    refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading) {
    return (
      <div className="page-shell-content pt-6 pb-24">
        <div className="h-40 animate-pulse rounded-3xl bg-surface/50" />
        <div className="mt-4 h-24 animate-pulse rounded-2xl bg-surface/40" />
        <div className="mt-3 h-52 animate-pulse rounded-2xl bg-surface/40" />
      </div>
    );
  }

  if (!card?.profile) {
    return (
      <div className="page-shell-content pt-6 pb-24">
        <Link
          to="/players"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to players
        </Link>
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center">
          <p className="font-semibold">Player not found</p>
          <p className="mt-1 text-sm text-muted-foreground">This card may have been removed.</p>
        </div>
      </div>
    );
  }

  const p = card.profile;
  const stats = card.stats;

  return (
    <div className="page-shell-flush pb-28">
      {/* Header */}
      <header className="relative">
        <div
          className="h-32 w-full bg-surface bg-cover bg-center"
          style={p.coverUrl ? { backgroundImage: `url(${p.coverUrl})` } : undefined}
          role="img"
          aria-label={`${p.displayName} cover image`}
        />
        <Link
          to="/players"
          aria-label="Back to players"
          className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-background/70 backdrop-blur"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="px-4">
          <div className="-mt-9 flex items-end gap-3">
            {p.avatarUrl ? (
              <img
                src={p.avatarUrl}
                alt={`${p.displayName} avatar`}
                loading="lazy"
                className="h-20 w-20 rounded-full border-4 border-background object-cover"
              />
            ) : (
              <div className="grid h-20 w-20 place-items-center rounded-full border-4 border-background bg-lime/20 font-display text-xl font-bold text-lime">
                {p.initials}
              </div>
            )}
          </div>
          <h1 className="mt-3 page-title">{p.displayName}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {p.username && <span>@{p.username.replace(/^@/, "")}</span>}
            {p.city && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-lime" />
                {p.city}
              </span>
            )}
          </p>
          {p.bio && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{p.bio}</p>}
          <Link
            to="/players/$userId"
            params={{ userId }}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-lime px-4 py-2.5 text-sm font-bold text-background"
          >
            View full profile <ExternalLink className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* Sticky section tabs */}
      <nav
        aria-label="Player card sections"
        className="sticky top-0 z-20 mt-4 flex gap-2 border-b border-border bg-background/90 px-4 py-2 backdrop-blur"
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => scrollTo(s.id)}
            aria-current={active === s.id}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold ${
              active === s.id
                ? "bg-lime/15 text-lime"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <s.icon className="h-4 w-4" />
            {s.label}
          </button>
        ))}
      </nav>

      {/* Highlights */}
      <section
        id="highlights"
        ref={(el) => {
          refs.current.highlights = el;
        }}
        className="scroll-mt-16 px-4 pt-5"
      >
        <h2 className="mb-2 section-eyebrow text-muted-foreground">Highlights</h2>
        {reels.length === 0 ? (
          <EmptyBlock text="No highlight reels published yet." />
        ) : (
          <div className="space-y-4">
            {reels.map((reel) => (
              <article
                key={reel.id}
                className="overflow-hidden rounded-2xl border border-border bg-surface"
              >
                <InlineVideoPlayer
                  videoUrl={reel.videoUrl}
                  fallbackVideoUrl={reel.fallbackVideoUrl}
                  thumbnailUrl={reel.thumbnailUrl}
                  ariaLabel={`Highlight reel ${reel.title}`}
                />
                <div className="p-3">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold">{reel.title}</p>
                    {reel.sport && (
                      <span className="shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-lime">
                        {reel.sport}
                      </span>
                    )}
                  </div>
                  {reel.gameTitle && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {reel.gameTitle}
                    </p>
                  )}
                  {reel.caption && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {reel.caption}
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Games */}
      <section
        id="games"
        ref={(el) => {
          refs.current.games = el;
        }}
        className="scroll-mt-16 px-4 pt-7"
      >
        <h2 className="mb-2 section-eyebrow text-muted-foreground">Games</h2>
        {upcoming.length === 0 && past.length === 0 ? (
          <EmptyBlock text="No games on this player's card yet." />
        ) : (
          <div className="space-y-4">
            {upcoming.length > 0 && <GameGroup title="Upcoming" games={upcoming} />}
            {past.length > 0 && <GameGroup title="Recent" games={past.slice(0, 12)} />}
          </div>
        )}
      </section>

      {/* Stats */}
      <section
        id="stats"
        ref={(el) => {
          refs.current.stats = el;
        }}
        className="scroll-mt-16 px-4 pt-7"
      >
        <h2 className="mb-2 section-eyebrow text-muted-foreground">Stats</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Games played" value={stats.gamesPlayed} />
          <StatTile label="Games hosted" value={stats.gamesHosted} />
          <StatTile label="Upcoming" value={stats.upcoming} />
          <StatTile label="Highlight reels" value={stats.reels} />
        </div>
        {stats.sports.length > 0 && (
          <div className="mt-3 rounded-2xl border border-border bg-surface p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Sports
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {stats.sports.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-lime/15 px-2.5 py-1 text-xs font-semibold text-lime"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}
        <Link
          to="/players/$userId"
          params={{ userId }}
          className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-border px-4 py-2.5 text-sm font-semibold"
        >
          See {p.displayName}'s full profile
        </Link>
      </section>
    </div>
  );
}

function GameGroup({ title, games }: { title: string; games: PlayerCardData["games"] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="space-y-2">
        {games.map((g) => (
          <li key={g.id}>
            <Link
              to="/games/$gameId"
              params={{ gameId: g.id }}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 active:opacity-80"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime/15 text-lime">
                <Calendar className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{g.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatGameDate(g.date)}
                  {g.location ? ` · ${g.location}` : ""}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {g.role === "host" ? "Host" : g.sport || "Player"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <p className="font-display text-2xl font-bold text-lime">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

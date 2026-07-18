import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { Search, SlidersHorizontal, Bell, MessageCircle, X, MapPin, Plus } from "lucide-react";
import { ViewDensityToggle } from "@/components/ViewDensityToggle";
import { PlayMapView } from "@/components/PlayMapView";
import { useUnreadNotificationCount } from "@/lib/notifications";
import { Logo } from "@/components/Logo";
import { MyAvatar } from "@/components/UserAvatar";
import { SportChips } from "@/components/SportChips";
import { GameCard } from "@/components/GameCard";
import { GameListRow } from "@/components/GameListRow";
import { GameCardSkeleton, GameListRowSkeleton } from "@/components/GameCardSkeleton";
import { GAMES, SPORTS, POSITIONS_BY_SPORT, type Sport } from "@/lib/sample-data";
import { useHostedGames } from "@/lib/hosted-games-store";
import { useJoinedGameIds } from "@/lib/games-store";
import { useFeedPrefs, setFeedPrefs, DEFAULT_PREFS, useMyProfile } from "@/lib/user-prefs-store";
import { miToKm } from "@/lib/distance";
import { clearScrollRestore, useScrollRestore } from "@/hooks/use-scroll-restore";
import { motion, AnimatePresence } from "framer-motion";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";

// URL-persisted feed state. Refreshing or sharing the URL preserves search
// text, sport chip, sort, distance cap, position, view/density toggles, and
// section flags. Values fall back to defaults when malformed or absent.
const feedSearchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  sport: fallback(z.string(), "").default(""),
  sort: fallback(z.string(), "").default(""),
  dist: fallback(z.number().nullable(), null).default(null),
  pos: fallback(z.string(), "").default(""),
  view: fallback(z.string(), "").default(""),
  density: fallback(z.string(), "").default(""),
  urgent: fallback(z.boolean().optional(), undefined).default(undefined),
  foryou: fallback(z.boolean().optional(), undefined).default(undefined),
  hosted: fallback(z.boolean().optional(), undefined).default(undefined),
  joined: fallback(z.boolean().optional(), undefined).default(undefined),
  free: fallback(z.boolean().optional(), undefined).default(undefined),
  paid: fallback(z.boolean().optional(), undefined).default(undefined),
});

export const Route = createFileRoute("/_tabs/feed")({
  head: () => ({ meta: [{ title: "Feed — OpenRun" }] }),
  validateSearch: zodValidator(feedSearchSchema),
  component: Feed,
});


function Feed() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/feed" });
  const [q, setQ] = useState(search.q ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "map">(() => {
    if (search.view === "list" || search.view === "map") return search.view;
    if (typeof window === "undefined") return "list";
    return (localStorage.getItem("openrun:play-view") as "list" | "map") ?? "list";
  });
  const switchView = (m: "list" | "map") => {
    setViewMode(m);
    try { localStorage.setItem("openrun:play-view", m); } catch { /* ignore */ }
  };
  const [density, setDensity] = useState<"grid" | "list">(() => {
    if (search.density === "grid" || search.density === "list") return search.density;
    if (typeof window === "undefined") return "grid";
    return (localStorage.getItem("openrun:feed-density") as "grid" | "list") ?? "grid";
  });
  const switchDensity = (d: "grid" | "list") => {
    setDensity(d);
    try { localStorage.setItem("openrun:feed-density", d); } catch { /* ignore */ }
  };
  const listContainerClass = density === "list"
    ? "flex flex-col gap-2"
    : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";
  const emptyColSpan = density === "list" ? "" : "sm:col-span-2 lg:col-span-3";
  const renderGame = (g: typeof GAMES[number], i: number) =>
    density === "list"
      ? <GameListRow key={g.id} game={g} index={i} />
      : <GameCard key={g.id} game={g} index={i} />;
  const renderSkeletons = (count: number) => {
    const Skel = density === "list" ? GameListRowSkeleton : GameCardSkeleton;
    return Array.from({ length: count }, (_, i) => <Skel key={`sk-${i}`} />);
  };
  const [positionFilter, setPositionFilter] = useState<string | null>(search.pos || null);
  const hosted = useHostedGames();
  const joinedIds = useJoinedGameIds();
  const prefs = useFeedPrefs();
  const profile = useMyProfile();
  const joinedSet = useMemo(() => new Set(joinedIds), [joinedIds]);
  const hostedIds = useMemo(() => new Set(hosted.map((g) => g.id)), [hosted]);

  // One-time hydration: URL wins over the stored prefs so a shared link
  // reproduces exactly what the sender saw. Runs once on mount.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const patch: Partial<typeof DEFAULT_PREFS> = {};
    if (search.sport) {
      const list = search.sport.split(",").map((s: string) => s.trim()).filter(Boolean) as Sport[];
      patch.preferredSports = list;
    }
    if (search.sort === "nearest" || search.sort === "soonest") patch.sortBy = search.sort;
    if (search.dist !== undefined) patch.maxDistanceMi = search.dist;
    const sec = { ...prefs.sections };
    let secTouched = false;
    for (const [k, v] of [
      ["showUrgent", search.urgent],
      ["showForYou", search.foryou],
      ["hostedByMeOnly", search.hosted],
      ["joinedOnly", search.joined],
      ["freeOnly", search.free],
      ["paidOnly", search.paid],
    ] as const) {
      if (typeof v === "boolean") { (sec as any)[k] = v; secTouched = true; }
    }
    if (secTouched) patch.sections = sec;
    if (Object.keys(patch).length > 0) setFeedPrefs({ ...prefs, ...patch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect current state back into the URL so refresh/share preserves it.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const next: Record<string, unknown> = {};
    if (q) next.q = q;
    if (prefs.preferredSports.length) next.sport = prefs.preferredSports.join(",");
    if (prefs.sortBy !== DEFAULT_PREFS.sortBy) next.sort = prefs.sortBy;
    if (prefs.maxDistanceMi != null) next.dist = prefs.maxDistanceMi;
    if (positionFilter) next.pos = positionFilter;
    if (viewMode !== "list") next.view = viewMode;
    if (density !== "grid") next.density = density;
    for (const [k, defKey, urlKey] of [
      ["showUrgent", "showUrgent", "urgent"],
      ["showForYou", "showForYou", "foryou"],
      ["hostedByMeOnly", "showUrgent" as any, "hosted"],
      ["joinedOnly", "showUrgent" as any, "joined"],
      ["freeOnly", "showUrgent" as any, "free"],
      ["paidOnly", "showUrgent" as any, "paid"],
    ] as const) {
      const cur = (prefs.sections as any)[k];
      const def = (DEFAULT_PREFS.sections as any)[k];
      if (cur !== def) next[urlKey] = cur;
      void defKey;
    }
    navigate({ search: next as any, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, prefs, positionFilter, viewMode, density]);

  const userCityToken = useMemo(
    () => (profile?.city ?? "").toLowerCase().split(",")[0].trim(),
    [profile?.city],
  );

  const isLocal = (g: { location: string; neighborhood?: string }) => {
    if (!userCityToken) return false;
    const hay = `${g.location} ${g.neighborhood ?? ""}`.toLowerCase();
    return hay.includes(userCityToken);
  };

  // Quick chip = single-sport shortcut for preferredSports.
  // null/empty = All sports. Multi-select still possible via the filter sheet.
  const chipSport: string | null =
    prefs.preferredSports.length === 1 ? prefs.preferredSports[0] : null;
  const setChipSport = (s: string | null) => {
    setFeedPrefs({ ...prefs, preferredSports: s ? [s as Sport] : [] });
    setPositionFilter(null);
  };

  const filtered = useMemo(() => {
    const all = [...hosted, ...GAMES];
    return all
      .filter((g) =>
        prefs.preferredSports.length ? prefs.preferredSports.includes(g.sport) : true,
      )
      .filter((g) =>
        positionFilter
          ? !!(g.positionsNeeded && (g.positionsNeeded[positionFilter] ?? 0) > 0)
          : true,
      )
      .filter((g) => (prefs.sections.hostedByMeOnly ? hostedIds.has(g.id) : true))
      .filter((g) => (prefs.sections.joinedOnly ? joinedSet.has(g.id) : true))
      .filter((g) => (prefs.sections.freeOnly ? g.price === 0 : true))
      .filter((g) => (prefs.sections.paidOnly ? g.price > 0 : true))
      .filter((g) =>
        prefs.maxDistanceMi != null ? g.distanceMi <= prefs.maxDistanceMi : true,
      )
      .filter((g) =>
        q
          ? (
              g.title +
              " " +
              g.location +
              " " +
              g.host.name +
              " " +
              g.sport +
              " " +
              (g.neighborhood ?? "")
            )
              .toLowerCase()
              .includes(q.toLowerCase())
          : true,
      )
      .sort((a, b) => {
        if (prefs.sortBy === "nearest") {
          // Nearest first; prefer local city, then distanceMi, then date.
          const la = isLocal(a) ? 0 : 1;
          const lb = isLocal(b) ? 0 : 1;
          if (la !== lb) return la - lb;
          if (a.distanceMi !== b.distanceMi) return a.distanceMi - b.distanceMi;
          return +new Date(a.date) - +new Date(b.date);
        }
        // Soonest first; break ties by distance.
        const da = +new Date(a.date) - +new Date(b.date);
        if (da !== 0) return da;
        return a.distanceMi - b.distanceMi;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, hosted, prefs, joinedSet, hostedIds, userCityToken, positionFilter]);

  const suggestions = useMemo(() => {
    if (!q) return [] as { label: string; sub: string }[];
    const needle = q.toLowerCase();
    const seen = new Set<string>();
    const out: { label: string; sub: string }[] = [];
    for (const g of [...hosted, ...GAMES]) {
      for (const cand of [
        { label: g.title, sub: g.location },
        { label: g.location, sub: g.sport },
        { label: g.host.name, sub: "Host" },
      ]) {
        if (out.length >= 5) break;
        if (!cand.label.toLowerCase().includes(needle)) continue;
        const key = cand.label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(cand);
      }
      if (out.length >= 5) break;
    }
    return out;
  }, [q, hosted]);

  const urgent = filtered.filter((g) => g.urgent);
  const activeFilterCount =
    (prefs.preferredSports.length > 0 ? 1 : 0) +
    (prefs.maxDistanceMi != null ? 1 : 0) +
    Object.entries(prefs.sections).filter(
      ([k, v]) => k in DEFAULT_PREFS.sections && v !== (DEFAULT_PREFS.sections as any)[k],
    ).length;

  // Infinite scroll: paginate the main filtered list. Page size scales with
  // viewport so tablets/desktops fill their wider grids in one batch.
  const PAGE_SIZE = 12;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const filterKey = `${q}|${JSON.stringify(prefs)}|${hosted.length}`;
  // Locks: prevent overlapping refresh and pagination so the same cards
  // never get appended twice when the user pulls while a fetch is mid-flight
  // (or the IO sentinel fires multiple times during a single scroll).
  const loadingMoreRef = useRef(false);
  const refreshingRef = useRef(false);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filterKey]);
  const hasMore = visibleCount < filtered.length;
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        if (loadingMoreRef.current || refreshingRef.current) return;
        loadingMoreRef.current = true;
        setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length));
        // Release on next frame so a single sentinel crossing yields a single page bump.
        requestAnimationFrame(() => {
          loadingMoreRef.current = false;
        });
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, filtered.length]);
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // Persist + restore scroll position and pagination depth across refresh /
  // back-forward so the user lands right back where they left off.
  useScrollRestore("feed", {
    pages: visibleCount,
    enabled: filtered.length > 0,
    onRestorePages: (n) => {
      if (!Number.isFinite(n)) return;
      setVisibleCount((cur) => Math.max(cur, Math.max(PAGE_SIZE, Math.min(n, filtered.length))));
    },
  });

  // Pull-to-refresh: drag from the top of the page when scrollY === 0.
  const router = useRouter();
  const [pull, setPull] = useState(0); // px pulled (clamped)
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const PULL_MAX = 96;
  const PULL_THRESHOLD = 64;
  const runRefresh = useCallback(async () => {
    if (refreshingRef.current) return; // ignore overlapping pulls
    refreshingRef.current = true;
    setRefreshing(true);
    setVisibleCount(PAGE_SIZE);
    clearScrollRestore("feed");
    try {
      await router.invalidate();
      await new Promise((r) => setTimeout(r, 450));
    } finally {
      setRefreshing(false);
      refreshingRef.current = false;
      setPull(0);
      startYRef.current = null;
    }
  }, [router]);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 0 || refreshing) return;
      startYRef.current = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current == null || refreshing) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) {
        setPull(0);
        return;
      }
      if (window.scrollY > 0) {
        startYRef.current = null;
        setPull(0);
        return;
      }
      // Rubber-band resistance.
      const resisted = Math.min(PULL_MAX, dy * 0.5);
      setPull(resisted);
      if (e.cancelable) e.preventDefault();
    };
    const onTouchEnd = () => {
      if (startYRef.current == null) return;
      if (pull >= PULL_THRESHOLD) {
        void runRefresh();
      } else {
        setPull(0);
        startYRef.current = null;
      }
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [pull, refreshing, runRefresh]);
  const indicatorOffset = refreshing ? 56 : pull;
  const indicatorProgress = Math.min(1, pull / PULL_THRESHOLD);

  return (
    <div
      className="relative mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-5xl xl:max-w-6xl px-4 pt-6"
      style={{
        transform: `translateY(${indicatorOffset}px)`,
        transition: pull === 0 || refreshing ? "transform 200ms ease" : "none",
      }}
    >
      <PullIndicator
        offset={indicatorOffset}
        progress={indicatorProgress}
        refreshing={refreshing}
      />
      <div className="flex items-center justify-between mb-5">
        <Logo />
        <div className="flex items-center gap-2">
          <Link
            to="/messages"
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
            aria-label="Messages"
          >
            <MessageCircle className="h-5 w-5" />
          </Link>
          <BellLink />
          <Link
            to="/profile"
            aria-label="Your profile"
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
          >
            <MyAvatar size="sm" />
          </Link>
        </div>
      </div>


      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
        <h1 className="font-display text-3xl font-bold leading-tight">Tonight's run.</h1>
        <p className="text-muted-foreground text-sm inline-flex items-center gap-1">
          {userCityToken ? (
            <>
              <MapPin className="h-3.5 w-3.5 text-lime" /> Nearest to {profile?.city} ·{" "}
              {filtered.length} games
            </>
          ) : (
            <>
              {filtered.length} games ·{" "}
              <Link to="/profile/edit" className="text-lime font-semibold">
                Set your city
              </Link>{" "}
              for nearby
            </>
          )}
        </p>
      </motion.div>

      <ViewDensityToggle
        view={viewMode}
        onViewChange={(v) => switchView(v)}
        density={density}
        onDensityChange={(d) => switchDensity(d)}
      />



      {viewMode === "map" ? (
        <PlayMapView />
      ) : (
      <>
      <div className="flex gap-2 mb-4 relative">
        <div className="flex-1 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search games, courts, players"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="Clear search">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
        <button
          onClick={() => setFiltersOpen(true)}
          className={`relative grid h-11 w-11 place-items-center rounded-full border bg-surface ${activeFilterCount ? "border-lime" : "border-border"}`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-lime text-[10px] font-bold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </button>
        {q && suggestions.length > 0 && (
          <div className="absolute left-0 right-14 top-full mt-2 z-20 rounded-2xl border border-border bg-surface shadow-lg overflow-hidden">
            {suggestions.map((s, idx) => (
              <button
                key={`${s.label}-${idx}`}
                onClick={() => setQ(s.label)}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-background border-b border-border last:border-b-0"
              >
                <div className="font-semibold truncate">{s.label}</div>
                <div className="text-xs text-muted-foreground truncate">{s.sub}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-5">
        <SportChips selected={chipSport} onSelect={setChipSport} />
        {chipSport && POSITIONS_BY_SPORT[chipSport as Sport]?.length > 0 && (
          <div className="mt-2 flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1">
            <button
              onClick={() => setPositionFilter(null)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                !positionFilter
                  ? "border-lime bg-lime text-primary-foreground"
                  : "border-border bg-surface text-muted-foreground"
              }`}
            >
              Any position
            </button>
            {POSITIONS_BY_SPORT[chipSport as Sport].map((p) => {
              const active = positionFilter === p;
              return (
                <button
                  key={p}
                  onClick={() => setPositionFilter(active ? null : p)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? "border-lime bg-lime text-primary-foreground"
                      : "border-border bg-surface text-foreground hover:border-lime/40"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {q ? (
        <>
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
            {filtered.length} result{filtered.length === 1 ? "" : "s"} for "{q}"
          </h2>
          <div className={listContainerClass}>
            {refreshing && filtered.length === 0
              ? renderSkeletons(density === "list" ? 6 : 3)
              : visible.map((g, i) => renderGame(g, i))}
            {hasMore && !refreshing && renderSkeletons(density === "list" ? 4 : 3)}
            {!refreshing && filtered.length === 0 && (
              <div className={`${emptyColSpan} rounded-2xl border border-border bg-surface p-8 text-center text-muted-foreground`}>
                No games match "{q}".
              </div>
            )}
          </div>
          <InfiniteSentinel ref={sentinelRef} hasMore={hasMore} total={filtered.length} />
        </>
      ) : (
        <>
          {prefs.sections.showUrgent && urgent.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-coral">
                  ⚡ Needs players now
                </h2>
                <span className="text-xs text-muted-foreground">{urgent.length} games</span>
              </div>
              <div className={listContainerClass}>
                {urgent.map((g, i) => renderGame(g, i))}
              </div>
            </div>
          )}

          {prefs.sections.showForYou && (
            <>
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
                For you
              </h2>
              <div className={listContainerClass}>
                {refreshing && filtered.length === 0
                  ? renderSkeletons(density === "list" ? 6 : 3)
                  : visible.map((g, i) => renderGame(g, i))}
                {hasMore && !refreshing && renderSkeletons(density === "list" ? 4 : 3)}
                {!refreshing && filtered.length === 0 && (
                  <div className={`${emptyColSpan} rounded-2xl border border-border bg-surface p-8 text-center text-muted-foreground space-y-3`}>
                    <div>No games match your filters.</div>
                    <button
                      onClick={() => setFeedPrefs(DEFAULT_PREFS)}
                      className="inline-flex rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
              <InfiniteSentinel ref={sentinelRef} hasMore={hasMore} total={filtered.length} />
            </>
          )}
        </>
      )}
      </>
      )}


      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {filtersOpen && <FilterSheet onClose={() => setFiltersOpen(false)} />}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}

function PullIndicator({
  offset,
  progress,
  refreshing,
}: {
  offset: number;
  progress: number;
  refreshing: boolean;
}) {
  if (offset <= 0 && !refreshing) return null;
  return (
    <div
      className="pointer-events-none absolute left-0 right-0 -top-12 flex justify-center"
      aria-hidden={!refreshing}
    >
      <div
        className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface shadow-md"
        style={{ opacity: Math.max(progress, refreshing ? 1 : 0) }}
      >
        <RefreshCw
          className={`h-4 w-4 text-lime ${refreshing ? "animate-spin" : ""}`}
          style={{ transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }}
        />
      </div>
    </div>
  );
}

const InfiniteSentinel = ({
  ref,
  hasMore,
  total,
}: {
  ref: React.Ref<HTMLDivElement>;
  hasMore: boolean;
  total: number;
}) => {
  if (total === 0) return null;
  return (
    <div ref={ref} className="mt-2 flex items-center justify-center py-4" aria-live="polite">
      {hasMore ? (
        <span className="sr-only">Loading more games…</span>
      ) : (
        <span className="text-xs text-muted-foreground">You're all caught up · {total} games</span>
      )}
    </div>
  );
};

function BellLink() {
  const unread = useUnreadNotificationCount();
  return (
    <Link
      to="/notifications"
      className="relative grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
      aria-label="Notifications"
    >
      <Bell className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 grid h-4 min-w-4 px-1 place-items-center rounded-full bg-coral text-[10px] font-bold text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}

function FilterSheet({ onClose }: { onClose: () => void }) {
  const prefs = useFeedPrefs();
  const profile = useMyProfile();
  const hasCity = Boolean(profile?.city?.trim());
  const preferredSports = prefs.preferredSports;
  const sections = prefs.sections;
  const unit = prefs.distanceUnit;
  const presetsMi = [5, 10, 25, 50, 100];

  const toggleSport = (s: Sport) => {
    const next = preferredSports.includes(s)
      ? preferredSports.filter((x) => x !== s)
      : [...preferredSports, s];
    setFeedPrefs({ ...prefs, preferredSports: next });
  };
  const toggleSection = (k: keyof typeof sections) => {
    const nextSections = { ...sections, [k]: !sections[k] };
    if (k === "paidOnly" && nextSections.paidOnly) nextSections.freeOnly = false;
    if (k === "freeOnly" && nextSections.freeOnly) nextSections.paidOnly = false;
    if (k === "hostedByMeOnly" && nextSections.hostedByMeOnly) nextSections.joinedOnly = false;
    if (k === "joinedOnly" && nextSections.joinedOnly) nextSections.hostedByMeOnly = false;
    setFeedPrefs({ ...prefs, sections: nextSections });
  };
  const setUnit = (u: "mi" | "km") => setFeedPrefs({ ...prefs, distanceUnit: u });
  const setMaxMi = (mi: number | null) => setFeedPrefs({ ...prefs, maxDistanceMi: mi });

  const reset = () =>
    setFeedPrefs({
      ...prefs,
      preferredSports: [],
      sections: DEFAULT_PREFS.sections,
      maxDistanceMi: null,
    });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur flex items-end justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 280, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl border-t border-border bg-background p-5 max-h-[85vh] overflow-y-auto pb-10"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-bold">Feed filters</h2>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-border"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
          Sort by
        </div>
        <div className="flex gap-2 mb-5">
          {(["nearest", "soonest"] as const).map((s) => {
            const active = prefs.sortBy === s;
            return (
              <button
                key={s}
                onClick={() => setFeedPrefs({ ...prefs, sortBy: s })}
                className={`flex-1 rounded-full border px-3 py-2 text-xs font-semibold ${active ? "border-lime bg-lime text-primary-foreground" : "border-border bg-surface"}`}
              >
                {s === "nearest" ? "Nearest" : "Soonest"}
              </button>
            );
          })}
        </div>

        <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
          Sport (Games)
        </div>
        <div className="flex flex-wrap gap-2 mb-5">
          {SPORTS.map((s) => {
            const active = preferredSports.includes(s.name);
            return (
              <button
                key={s.name}
                onClick={() => toggleSport(s.name)}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? "border-lime bg-lime text-primary-foreground" : "border-border bg-surface"}`}
              >
                <span>{s.emoji}</span>
                {s.name}
              </button>
            );
          })}
        </div>

        <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider flex items-center justify-between">
          <span>
            Distance from you
            {hasCity && profile?.city ? (
              <span className="ml-2 normal-case tracking-normal text-muted-foreground/80">
                · {profile.city}
              </span>
            ) : null}
          </span>
          <span className="inline-flex rounded-full border border-border bg-surface p-0.5">
            {(["mi", "km"] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${unit === u ? "bg-lime text-primary-foreground" : "text-muted-foreground"}`}
              >
                {u}
              </button>
            ))}
          </span>
        </div>
        {!hasCity && (
          <p className="text-xs text-muted-foreground mb-2">
            <Link to="/profile/edit" className="text-lime font-semibold">
              Set your city
            </Link>{" "}
            to filter by distance.
          </p>
        )}
        <div className={`flex flex-wrap gap-2 mb-5 ${hasCity ? "" : "opacity-50 pointer-events-none"}`}>
          <button
            onClick={() => setMaxMi(null)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${prefs.maxDistanceMi == null ? "border-lime bg-lime text-primary-foreground" : "border-border bg-surface"}`}
          >
            Any
          </button>
          {presetsMi.map((mi) => {
            const active = prefs.maxDistanceMi === mi;
            const label = unit === "mi" ? `${mi} mi` : `${miToKm(mi)} km`;
            return (
              <button
                key={mi}
                onClick={() => setMaxMi(mi)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? "border-lime bg-lime text-primary-foreground" : "border-border bg-surface"}`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
          Sections
        </div>
        <div className="space-y-2 mb-5">
          {(
            [
              ["showUrgent", "Needs players now"],
              ["showForYou", '"For you" list'],
              ["hostedByMeOnly", "Games I host"],
              ["joinedOnly", "Games I joined"],
              ["freeOnly", "Free games"],
              ["paidOnly", "Paid games"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => toggleSection(k)}
              className="w-full flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-semibold"
            >
              <span>{label}</span>
              <span
                className={`h-6 w-10 rounded-full p-0.5 transition-colors ${sections[k] ? "bg-lime" : "bg-secondary"}`}
              >
                <span
                  className={`block h-5 w-5 rounded-full bg-background transition-transform ${sections[k] ? "translate-x-4" : ""}`}
                />
              </span>
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={reset}
            className="flex-1 rounded-full border border-border py-3 text-sm font-bold"
          >
            Reset
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-full bg-lime-gradient py-3 text-sm font-bold text-primary-foreground"
          >
            Done
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

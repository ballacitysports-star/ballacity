import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarSearch, RefreshCw, Search, X } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Bell, MessageCircle, MapPin } from "lucide-react";
import { ViewDensityToggle } from "@/components/ViewDensityToggle";
import { PlayMapView } from "@/components/PlayMapView";
import { useUnreadNotificationCount } from "@/lib/notifications";
import { Logo } from "@/components/Logo";
import { MyAvatar } from "@/components/UserAvatar";
import { SportChips } from "@/components/SportChips";
import { parseSportList, serializeSportList } from "@/lib/sport-filter";
import { GameCard } from "@/components/GameCard";
import { GameListRow } from "@/components/GameListRow";
import { GameCardSkeleton, GameListRowSkeleton } from "@/components/GameCardSkeleton";
import { FilterBar } from "@/components/FilterBar";
import { FeedPreferencesBody, FeedViewsRow } from "@/components/feed/FeedPreferencesSheet";
import { useFeedPrefsSync } from "@/hooks/use-feed-prefs-sync";
import { GAMES, SPORTS, POSITIONS_BY_SPORT, type Sport } from "@/lib/sample-data";
import { useHostedGames } from "@/lib/hosted-games-store";
import { useJoinedGameIds } from "@/lib/games-store";
import {
  useFeedPrefs,
  setFeedPrefs,
  DEFAULT_PREFS,
  DEFAULT_FILTERS,
  useMyProfile,
  getFeedPrefsSnapshot,
} from "@/lib/user-prefs-store";
import { markSportChoice, useProfileSportDefault } from "@/lib/default-sports";
import { useAuth } from "@/hooks/use-auth";
import { useUserLocation } from "@/lib/geo";
import { gameDistanceMi } from "@/lib/game-distance";

import { clearScrollRestore, useScrollRestore } from "@/hooks/use-scroll-restore";
import { motion } from "framer-motion";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { hideFinishedGames, onlyFinishedGames } from "@/lib/game-time";
import { collapseSeriesGames } from "@/lib/game-series";
import { LocationAccessDialog } from "@/components/LocationAccessDialog";

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
  tab: fallback(z.string(), "upcoming").default("upcoming"),
});

export const Route = createFileRoute("/_tabs/feed")({
  head: () =>
    pageHead({
      path: "/feed",
      title: "Pickup Sports Games Near You | BallaCity",
      description: "Pickup runs picked for your sports, skill level, and distance.",
      noindex: true,
    }),
  validateSearch: zodValidator(feedSearchSchema),
  component: Feed,
});

function Feed() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/feed" });
  const [q, setQ] = useState(search.q ?? "");
  const [tab, setTab] = useState<"upcoming" | "archive">(
    search.tab === "archive" ? "archive" : "upcoming",
  );

  const [viewMode, setViewMode] = useState<"list" | "map">(() => {
    if (search.view === "list" || search.view === "map") return search.view;
    if (typeof window === "undefined") return "list";
    return (localStorage.getItem("openrun:play-view") as "list" | "map") ?? "list";
  });
  const switchView = (m: "list" | "map") => {
    setViewMode(m);
    try {
      localStorage.setItem("openrun:play-view", m);
    } catch {
      /* ignore */
    }
  };
  // Card density is automatic: one column on phones, 2–3 on wider screens.
  const density = "grid" as const;
  const listContainerClass = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";
  const emptyColSpan = "sm:col-span-2 lg:col-span-3";
  const renderGame = (g: (typeof GAMES)[number], i: number) => (
    <GameCard key={g.id} game={g} index={i} />
  );
  const renderSkeletons = (count: number) =>
    Array.from({ length: count }, (_, i) => <GameCardSkeleton key={`sk-${i}`} />);
  const [positionFilter, setPositionFilter] = useState<string | null>(search.pos || null);
  const hosted = useHostedGames();
  const joinedIds = useJoinedGameIds();
  const prefs = useFeedPrefs();
  const { user: authUser } = useAuth();
  useFeedPrefsSync();
  const profile = useMyProfile();
  const {
    coords,
    status: geoStatus,
    remembered: locationRemembered,
    explanation: locationExplanation,
    request: requestLocation,
    error: locationError,
  } = useUserLocation();
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  // A tap must always do something: fall back to manual entry when the browser
  // refuses to hand over a position.
  // The prompt is shown once per session; dismissing it hides it until the next.
  const [locPromptHidden, setLocPromptHidden] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem("openrun:loc-prompt-hidden") === "1") setLocPromptHidden(true);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const dismissLocPrompt = () => {
    setLocPromptHidden(true);
    try {
      sessionStorage.setItem("openrun:loc-prompt-hidden", "1");
    } catch {
      /* ignore */
    }
  };
  const handleLocationTap = async () => {
    if (geoStatus === "denied" || geoStatus === "unsupported" || locationError) {
      setLocationDialogOpen(true);
      return;
    }
    const snap = await requestLocation();
    if (!snap?.coords || snap.status !== "granted") setLocationDialogOpen(true);
  };

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
      patch.preferredSports = parseSportList(search.sport) as Sport[];
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
      if (typeof v === "boolean") {
        (sec as any)[k] = v;
        secTouched = true;
      }
    }
    if (secTouched) patch.sections = sec;
    if (Object.keys(patch).length > 0) setFeedPrefs({ ...prefs, ...patch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // First visit only: start the feed filtered to the viewer's profile sports.
  // Signed-out viewers are mid-redirect to /auth — writing prefs there would
  // trigger the URL sync below and fight that redirect.
  useProfileSportDefault("feed", {
    ready: !!authUser,
    current: prefs.preferredSports as string[],
    apply: (next) => setFeedPrefs({ ...getFeedPrefsSnapshot(), preferredSports: next as Sport[] }),
  });

  // Reflect current state back into the URL so refresh/share preserves it.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const next: Record<string, unknown> = {};
    if (q) next.q = q;
    if (prefs.preferredSports.length) next.sport = serializeSportList(prefs.preferredSports);
    if (prefs.sortBy !== DEFAULT_PREFS.sortBy) next.sort = prefs.sortBy;
    if (prefs.maxDistanceMi != null) next.dist = prefs.maxDistanceMi;
    if (positionFilter) next.pos = positionFilter;
    if (viewMode !== "list") next.view = viewMode;
    if (tab !== "upcoming") next.tab = tab;
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
    // Only write the URL while this route is still the active match and the
    // viewer is signed in — otherwise this fights the auth gate's redirect to
    // /auth and can strand the app on the loading screen.
    if (!authUser) return;
    if (!router.state.location.pathname.startsWith("/feed")) return;
    try {
      navigate({ search: next as any, replace: true });
    } catch (e) {
      console.warn("feed url sync skipped", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, prefs, positionFilter, viewMode, density, tab, authUser]);

  const userCityToken = useMemo(
    () => (profile?.city ?? "").toLowerCase().split(",")[0].trim(),
    [profile?.city],
  );

  const isLocal = (g: { location: string; neighborhood?: string }) => {
    if (!userCityToken) return false;
    const hay = `${g.location} ${g.neighborhood ?? ""}`.toLowerCase();
    return hay.includes(userCityToken);
  };

  // Chip row mirrors the multi-select made in the filter sheet. Tapping a
  // chip toggles that sport in/out of preferredSports; "All sports" clears.
  const chipSelected: string[] = prefs.preferredSports;

  const setChipSport = (s: string | null) => {
    markSportChoice("feed");
    if (s === null) {
      setFeedPrefs({ ...prefs, preferredSports: [] });
    } else {
      const has = prefs.preferredSports.includes(s as Sport);
      const next = has
        ? prefs.preferredSports.filter((x) => x !== s)
        : [...prefs.preferredSports, s as Sport];
      setFeedPrefs({ ...prefs, preferredSports: next });
    }
    setPositionFilter(null);
  };

  const filtered = useMemo(() => {
    // Collapse multi-day series first so one event never shows duplicate cards.
    const pool = collapseSeriesGames([...hosted, ...GAMES], tab);
    const all = tab === "archive" ? onlyFinishedGames(pool) : hideFinishedGames(pool);
    return (
      all
        .filter((g) =>
          prefs.preferredSports.length ? prefs.preferredSports.includes(g.sport) : true,
        )
        .filter((g) =>
          positionFilter
            ? !!(g.positionsNeeded && (g.positionsNeeded[positionFilter] ?? 0) > 0)
            : true,
        )
        .filter((g) => (prefs.mineFilter === "hosting" ? hostedIds.has(g.id) : true))
        .filter((g) => (prefs.mineFilter === "joined" ? joinedSet.has(g.id) : true))
        .filter((g) => (prefs.moneyFilter === "free" ? g.price === 0 : true))
        .filter((g) => (prefs.moneyFilter === "paid" ? g.price > 0 : true))

        // Distance cap uses the live viewer→venue distance. Games we can't
        // measure (no viewer location yet, or an ungeocoded venue) are never
        // hidden — hiding them would look like the game vanished.
        .filter((g) => {
          if (prefs.maxDistanceMi == null) return true;
          const mi = gameDistanceMi(g, coords);
          return mi == null ? true : mi <= prefs.maxDistanceMi;
        })
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
          // Archive lists the most recently finished games first.
          if (tab === "archive") return +new Date(b.date) - +new Date(a.date);
          if (prefs.sortBy === "nearest") {
            // Nearest first; prefer local city, then distanceMi, then date.
            const la = isLocal(a) ? 0 : 1;
            const lb = isLocal(b) ? 0 : 1;
            if (la !== lb) return la - lb;
            const dA = gameDistanceMi(a, coords) ?? Infinity;
            const dB = gameDistanceMi(b, coords) ?? Infinity;
            if (dA !== dB) return dA - dB;
            return +new Date(a.date) - +new Date(b.date);
          }
          // Soonest first; break ties by distance.
          const da = +new Date(a.date) - +new Date(b.date);
          if (da !== 0) return da;
          return (gameDistanceMi(a, coords) ?? Infinity) - (gameDistanceMi(b, coords) ?? Infinity);
        })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, hosted, prefs, joinedSet, hostedIds, userCityToken, positionFilter, tab, coords]);

  const suggestions = useMemo(() => {
    if (!q) return [] as { label: string; sub: string }[];
    const needle = q.toLowerCase();
    const seen = new Set<string>();
    const out: { label: string; sub: string }[] = [];
    for (const g of hideFinishedGames([...hosted, ...GAMES])) {
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

  const isFull = (g: (typeof GAMES)[number]) => g.joined >= g.maxPlayers;

  const urgent = tab === "archive" ? [] : filtered.filter((g) => g.urgent && !isFull(g));
  const finishedCount = useMemo(() => onlyFinishedGames([...hosted, ...GAMES]).length, [hosted]);
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
  const filterKey = `${tab}|${q}|${JSON.stringify(prefs)}|${hosted.length}`;
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
      className="relative page-shell pt-6"
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

      <h1 className="sr-only">{tab === "archive" ? "Finished games" : "Pickup runs"}</h1>
      {/* One slim row instead of a headline, a timeframe toggle and two toggle
          groups: where you are on the left, the layout switch on the right. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4 flex items-center justify-between gap-3"
      >
        {tab === "archive" ? (
          <button
            type="button"
            onClick={() => setTab("upcoming")}
            className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-lime"
          >
            <ArrowLeft className="h-4 w-4" /> Back to upcoming
          </button>
        ) : (
          <p className="inline-flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-lime" />
            {userCityToken ? (
              <span className="truncate">
                Nearest to <span className="font-semibold text-foreground">{profile?.city}</span>
              </span>
            ) : (
              <span className="truncate">
                <Link to="/profile/edit" className="font-semibold text-lime">
                  Set your city
                </Link>{" "}
                for nearby
              </span>
            )}
          </p>
        )}
        <ViewDensityToggle
          variant="icons"
          view={viewMode}
          onViewChange={(v) => switchView(v)}
          density={density}
          onDensityChange={(d) => switchDensity(d)}
        />
      </motion.div>

      {viewMode === "map" ? (
        <PlayMapView
          items={filtered}
          getHref={(g) => ({ to: "/games/$gameId", params: { gameId: g.id } })}
        />
      ) : (
        <>
          <div className="relative mb-4">
            <FilterBar
              q={q}
              onQChange={setQ}
              searchPlaceholder="Search pickup runs"
              activeFilterCount={activeFilterCount}
              create={{ to: "/create", label: "Create game" }}
              sheetTitle="Feed filters"
              sheet={<FeedPreferencesBody />}
              onReset={() => setFeedPrefs({ ...prefs, ...DEFAULT_FILTERS, activeViewId: null })}
            />
            {q && suggestions.length > 0 && (
              <div className="absolute left-0 right-14 top-full mt-1 z-20 rounded-2xl border border-border bg-surface shadow-lg overflow-hidden">
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

          {prefs.savedViews.length > 0 && (
            <div className="mb-3">
              <FeedViewsRow compact />
            </div>
          )}

          <div className="mb-5">
            <SportChips multi selected={chipSelected} onSelect={setChipSport} />
            {chipSelected.length === 1 &&
              POSITIONS_BY_SPORT[chipSelected[0] as Sport]?.length > 0 && (
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
                  {POSITIONS_BY_SPORT[chipSelected[0] as Sport].map((p) => {
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

          {(prefs.maxDistanceMi != null || prefs.sortBy === "nearest") &&
            geoStatus !== "unsupported" &&
            (!coords || locationRemembered) &&
            !locPromptHidden && (
              <div className="mb-4 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleLocationTap}
                  title={locationExplanation}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold"
                >
                  <MapPin className="h-3.5 w-3.5 text-coral" />
                  {geoStatus === "prompting"
                    ? "Locating…"
                    : locationRemembered
                      ? "Using your last known location — refresh"
                      : geoStatus === "denied"
                        ? "Location blocked — tap to retry"
                        : "Use my location to sort and filter by distance"}
                </button>
                <button
                  type="button"
                  onClick={dismissLocPrompt}
                  aria-label="Dismiss location prompt"
                  className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          <LocationAccessDialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen} />

          {q ? (
            <>
              <h2 className="section-eyebrow text-muted-foreground mb-2">
                {filtered.length} result{filtered.length === 1 ? "" : "s"} for "{q}"
              </h2>
              <div className={listContainerClass}>
                {refreshing && filtered.length === 0
                  ? renderSkeletons(density === "list" ? 6 : 3)
                  : visible.map((g, i) => renderGame(g, i))}
                {hasMore && !refreshing && renderSkeletons(density === "list" ? 4 : 3)}
                {!refreshing && filtered.length === 0 && (
                  <EmptyState
                    className={emptyColSpan}
                    icon={<Search className="h-6 w-6" aria-hidden />}
                    title={`No games match "${q}"`}
                    description="Try a shorter search, or a different sport or city name."
                  />
                )}
              </div>
              <InfiniteSentinel ref={sentinelRef} hasMore={hasMore} total={filtered.length} />
            </>
          ) : (
            <>
              {prefs.sections.showUrgent && urgent.length > 0 && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="section-eyebrow text-coral">⚡ Needs players now</h2>
                    <span className="text-xs text-muted-foreground">{urgent.length} games</span>
                  </div>
                  <div className={listContainerClass}>{urgent.map((g, i) => renderGame(g, i))}</div>
                </div>
              )}

              {(tab === "archive" || prefs.sections.showForYou) && (
                <>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h2 className="section-eyebrow text-muted-foreground">
                      {tab === "archive" ? "Recently finished" : "For you"}
                    </h2>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground">
                      {filtered.length} {filtered.length === 1 ? "game" : "games"}
                      {tab === "upcoming" && finishedCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setTab("archive")}
                          className="font-semibold text-lime"
                        >
                          Finished ({finishedCount})
                        </button>
                      )}
                    </span>
                  </div>
                  <div className={listContainerClass}>
                    {refreshing && filtered.length === 0
                      ? renderSkeletons(density === "list" ? 6 : 3)
                      : visible.map((g, i) => renderGame(g, i))}
                    {hasMore && !refreshing && renderSkeletons(density === "list" ? 4 : 3)}
                    {!refreshing && filtered.length === 0 && (
                      <EmptyState
                        className={emptyColSpan}
                        icon={<CalendarSearch className="h-6 w-6" aria-hidden />}
                        title={
                          tab === "archive"
                            ? "No finished games match your filters"
                            : "No games match your filters"
                        }
                        description="Your sport, distance, date or skill filters are narrowing this down. Clearing them shows everything nearby."
                        action={
                          <button
                            onClick={() => setFeedPrefs(DEFAULT_PREFS)}
                            className="inline-flex rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-primary-foreground"
                          >
                            Clear filters
                          </button>
                        }
                      />
                    )}
                  </div>
                  <InfiniteSentinel ref={sentinelRef} hasMore={hasMore} total={filtered.length} />
                </>
              )}
              {/* The list heading carries this link; keep archive reachable when
                  that list is switched off in feed settings. */}
              {tab === "upcoming" && !prefs.sections.showForYou && finishedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setTab("archive")}
                  className="text-xs font-semibold text-lime"
                >
                  Finished ({finishedCount})
                </button>
              )}
            </>
          )}
        </>
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
      to="/messages"
      search={{ tab: "alerts" } as any}
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

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { matchesOrgQuery } from "@/lib/org-search";
import { pageHead } from "@/lib/seo";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Megaphone, MapPin, Shield } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useAllOrgs } from "@/lib/org-store";
import { OrgCard } from "@/components/OrgCard";
import { SportChips } from "@/components/SportChips";
import {
  matchesSportList,
  parseSportList,
  serializeSportList,
  toggleSport,
} from "@/lib/sport-filter";
import { markSportChoice, useProfileSportDefault } from "@/lib/default-sports";
import { ViewDensityToggle, type ViewMode, type Density } from "@/components/ViewDensityToggle";
import { TeamsMapView } from "@/components/TeamsMapView";
import { FilterBar } from "@/components/FilterBar";
import { FilterSection, ChipRow } from "@/components/FilterSheet";
import { useMyProfile } from "@/lib/user-prefs-store";
import { useAuth } from "@/hooks/use-auth";
import { usePersistedSearch } from "@/hooks/use-persisted-search";
import { Distance } from "@/components/Distance";
import { useUserLocation } from "@/lib/geo";
import { orgDistance } from "@/lib/org-distance";
import { useOrgCityCoords } from "@/hooks/use-org-city-coords";
import { EnableDistanceButton } from "@/components/EnableDistanceButton";
import { SortSection, SortSummary } from "@/components/filters/SortSection";

type SortBy = "nearest" | "followers" | "name";

const TEAM_SORTS = [
  { value: "nearest" as const, label: "Nearest" },
  { value: "followers" as const, label: "Most followers" },
  { value: "name" as const, label: "Name A–Z" },
];

// URL-persisted Teams state. Refreshing or sharing the URL restores the
// exact view: search text, sport, availability, sort, and the view/density
// toggles. Trainers/coaches now live at /trainers.
const teamsSearchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  kind: fallback(z.string(), "team").default("team"),
  sport: fallback(z.string(), "").default(""),
  avail: fallback(z.string(), "any").default("any"),
  sort: fallback(z.string(), "nearest").default("nearest"),
  view: fallback(z.string(), "list").default("list"),
  density: fallback(z.string(), "list").default("list"),
});

export const Route = createFileRoute("/_tabs/teams")({
  head: () =>
    pageHead({
      path: "/teams",
      title: "Find Local Sports Teams & Players | BallaCity",
      description:
        "Discover teams and clubs near you. Follow squads, find tryouts, and join open runs.",
      noindex: true,
    }),
  validateSearch: zodValidator(teamsSearchSchema),
  component: TeamsPage,
});

function TeamsPage() {
  const { user } = useAuth();
  const profile = useMyProfile(user);
  const search = Route.useSearch();
  type TeamsSearch = typeof search;
  const navigate = useNavigate({ from: "/teams" });
  const updateSearch = (patch: Partial<TeamsSearch>) =>
    navigate({ search: (prev: TeamsSearch) => ({ ...prev, ...patch }), replace: true });
  const { hydrated } = usePersistedSearch("openrun:teams-search", search, "/teams", {
    q: "",
    kind: "team",
    sport: "",
    avail: "any",
    sort: "nearest",
    view: "list",
    density: "list",
  });

  // Legacy /teams?kind=coach → redirect to /trainers preserving other params.
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (redirectedRef.current) return;
    if (search.kind === "coach") {
      redirectedRef.current = true;
      navigate({
        to: "/trainers",
        search: {
          q: search.q,
          sport: search.sport,
          avail: search.avail,
          sort: search.sort,
          view: search.view,
          density: search.density,
        },
        replace: true,
      });
    }
  }, [search, navigate]);

  const q = search.q;
  // `sport` is a comma-separated multi-sport selection.
  const sports = useMemo(() => parseSportList(search.sport), [search.sport]);
  const sortBy: SortBy =
    search.sort === "followers" || search.sort === "name" ? search.sort : "nearest";
  const avail: "any" | "recruiting" | "weekly" | "casual" =
    search.avail === "recruiting" || search.avail === "weekly" || search.avail === "casual"
      ? search.avail
      : "any";
  const viewMode: ViewMode = search.view === "map" ? "map" : "list";
  const density: Density = search.density === "grid" ? "grid" : "list";

  const setQ = (v: string) => updateSearch({ q: v });
  const toggleSportFilter = (v: string | null) => {
    markSportChoice("teams");
    updateSearch({ sport: serializeSportList(toggleSport(sports, v)) });
  };
  // Default to the viewer's profile sports until they pick for themselves.
  useProfileSportDefault("teams", {
    ready: hydrated,
    current: sports,
    apply: (next) => updateSearch({ sport: serializeSportList(next) }),
  });
  const setSortBy = (v: SortBy) => updateSearch({ sort: v });
  const setAvail = (v: "any" | "recruiting" | "weekly" | "casual") => updateSearch({ avail: v });
  const switchView = (v: ViewMode) => updateSearch({ view: v });
  const switchDensity = (d: Density) => updateSearch({ density: d });

  // One-time migration from previously-persisted localStorage keys.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current) return;
    migratedRef.current = true;
    if (typeof window === "undefined") return;
    try {
      const hasSearch = window.location.search.length > 1;
      const rawV = window.localStorage.getItem("openrun:teams-view");
      const rawD = window.localStorage.getItem("openrun:teams-density");
      if (!hasSearch && (rawV || rawD)) {
        const patch: Partial<TeamsSearch> = {};
        if (rawV === "map" || rawV === "list") patch.view = rawV;
        if (rawD === "grid" || rawD === "list") patch.density = rawD;
        if (Object.keys(patch).length > 0) {
          navigate({ search: (prev: TeamsSearch) => ({ ...prev, ...patch }), replace: true });
        }
      }
      window.localStorage.removeItem("openrun:teams-view");
      window.localStorage.removeItem("openrun:teams-density");
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const orgs = useAllOrgs();
  const { coords } = useUserLocation();
  const cityCoords = useOrgCityCoords(
    orgs.filter((o) => o.kind === "team"),
    !!user && !!coords,
  );

  const list = useMemo(() => {
    const isRecruiting = (o: (typeof orgs)[number]) => {
      const pn = o.positionsNeeded;
      if (!pn) return false;
      return Object.values(pn).some((byPos) =>
        Object.values(byPos ?? {}).some((n) => Number(n) > 0),
      );
    };
    const cadenceMatches = (o: (typeof orgs)[number], target: "weekly" | "casual") => {
      const c = (o.cadence ?? "").toLowerCase();
      if (!c) return false;
      if (target === "weekly") return /week|multiple|daily/.test(c);
      return /month|casual|occasion|pickup|drop/.test(c);
    };
    const filtered = orgs
      .filter((o) => o.kind === "team")
      .filter((o) => matchesSportList(o.sports, sports))
      .filter((o) => {
        if (avail === "any") return true;
        if (avail === "recruiting") return isRecruiting(o);
        return cadenceMatches(o, avail);
      })
      .filter((o) => matchesOrgQuery(o, q));
    const withDist = filtered.map((o) => ({ o, dist: orgDistance(o, coords, cityCoords) }));
    withDist.sort((a, b) => {
      if (sortBy === "nearest") {
        // Teams we can't measure sort last, then alphabetically.
        const ax = a.dist?.mi ?? Infinity;
        const bx = b.dist?.mi ?? Infinity;
        if (ax !== bx) return ax - bx;
        return a.o.name.localeCompare(b.o.name);
      }
      if (sortBy === "followers") return b.o.followers - a.o.followers;
      return a.o.name.localeCompare(b.o.name);
    });
    return withDist;
  }, [orgs, sports, q, sortBy, avail, coords, cityCoords]);

  const featured =
    orgs.find((o) => o.verified && o.kind === "team") ?? orgs.find((o) => o.kind === "team");

  return (
    <div className="page-shell-content pt-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
        <h1 className="page-title">Teams & clubs.</h1>
        <p className="text-muted-foreground text-sm inline-flex items-center gap-1">
          {profile?.city ? (
            <>
              <MapPin className="h-3.5 w-3.5 text-lime" /> Nearest to {profile.city} · {list.length}{" "}
              {list.length === 1 ? "result" : "results"}
            </>
          ) : (
            <>
              {list.length} {list.length === 1 ? "result" : "results"} ·{" "}
              <Link to="/profile/edit" className="text-lime font-semibold">
                Set your city
              </Link>{" "}
              for nearby
            </>
          )}
        </p>
      </motion.div>

      <EnableDistanceButton className="mb-4" />

      {/* Looking for coaches? Cross-link to /trainers */}
      <div className="mb-4 text-xs text-muted-foreground">
        Looking for a coach?{" "}
        <Link to="/trainers" className="text-lime font-semibold">
          Browse trainers →
        </Link>
      </div>

      {/* Featured banner */}
      {featured && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative mb-5 overflow-hidden rounded-3xl border border-lime/30 bg-surface"
        >
          <img src={featured.cover} alt="" className="h-32 w-full object-cover opacity-50" />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
          <div className="absolute inset-0 p-4 flex flex-col justify-end">
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime uppercase tracking-wider">
              <Megaphone className="h-3 w-3" /> Hiring · 3 spots
            </span>
            <div className="mt-1 font-display text-xl font-bold">
              {featured.name} · Open Tryouts
            </div>
            <div className="text-xs text-muted-foreground">{featured.tagline}</div>
          </div>
        </motion.div>
      )}

      {/* Search */}
      <ViewDensityToggle
        view={viewMode}
        onViewChange={switchView}
        density={density}
        onDensityChange={switchDensity}
      />

      {(() => {
        const activeFilterCount =
          (sports.length ? 1 : 0) + (avail !== "any" ? 1 : 0) + (sortBy !== "nearest" ? 1 : 0);
        return (
          <FilterBar
            q={q}
            onQChange={setQ}
            searchPlaceholder="Search teams, sport, city"
            activeFilterCount={activeFilterCount}
            create={{ to: "/teams/create", label: "Create team" }}
            sheetTitle="Filter teams"
            onReset={() => updateSearch({ sport: "", avail: "any", sort: "nearest" })}
            resetDisabled={activeFilterCount === 0}
            sheet={
              <>
                <FilterSection label="Sports">
                  <SportChips multi selected={sports} onSelect={toggleSportFilter} />
                </FilterSection>
                <FilterSection label="Availability">
                  <ChipRow
                    value={avail}
                    onChange={setAvail}
                    options={[
                      { value: "any", label: "Any" },
                      { value: "recruiting", label: "Recruiting" },
                      { value: "weekly", label: "Weekly+" },
                      { value: "casual", label: "Casual" },
                    ]}
                  />
                </FilterSection>
                <SortSection value={sortBy} onChange={setSortBy} options={TEAM_SORTS} />
              </>
            }
          />
        );
      })()}

      <div className="mb-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {list.length} {list.length === 1 ? "result" : "results"}
        </span>
        <SortSummary value={sortBy} options={TEAM_SORTS} />
      </div>

      {viewMode === "map" ? (
        <TeamsMapView orgs={list.map((x) => x.o)} kind="team" />
      ) : (
        <div
          className={
            density === "grid" ? "grid grid-cols-1 sm:grid-cols-2 gap-3 pb-6" : "space-y-3 pb-6"
          }
        >
          {list.map(({ o, dist }, i) => (
            <div key={o.id} className="relative">
              <OrgCard org={o} index={i} />
              {dist && (
                <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-background/70 backdrop-blur px-2 py-0.5 text-[10px] font-bold text-foreground">
                  {dist.approx && "~"}
                  <Distance mi={dist.mi} decimals={dist.mi < 10 ? 1 : 0} />
                </span>
              )}
            </div>
          ))}
          {list.length === 0 && (
            <EmptyState
              className="sm:col-span-2"
              icon={<Shield className="h-6 w-6" aria-hidden />}
              title="No teams match your filters"
              description="Try a wider distance or a different sport — new teams are added all the time."
            />
          )}
        </div>
      )}
    </div>
  );
}

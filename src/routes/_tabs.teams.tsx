import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Search, Plus, Megaphone, ArrowUpDown, MapPin, SlidersHorizontal } from "lucide-react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { type Sport } from "@/lib/sample-data";
import { useAllOrgs } from "@/lib/org-store";
import { OrgCard } from "@/components/OrgCard";
import { SportChips } from "@/components/SportChips";
import { ViewDensityToggle, type ViewMode, type Density } from "@/components/ViewDensityToggle";
import { TeamsMapView } from "@/components/TeamsMapView";
import { CommunityTabs } from "@/components/CommunityTabs";
import { useMyProfile } from "@/lib/user-prefs-store";
import { useAuth } from "@/hooks/use-auth";


type SortBy = "nearest" | "followers" | "name";

// Deterministic pseudo-distance (miles) from a string, so sort order is stable.
function pseudoDistance(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return Math.round(((h % 400) / 10 + 0.3) * 10) / 10; // 0.3 – 40.3 mi
}

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
  head: () => ({
    meta: [
      { title: "Teams & clubs — OpenRun" },
      { name: "description", content: "Discover teams and clubs near you. Follow squads, find tryouts, join open runs." },
      { property: "og:title", content: "Teams & clubs — OpenRun" },
      { property: "og:description", content: "Discover teams and clubs near you." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
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
  const sport: Sport | null = (search.sport || null) as Sport | null;
  const sortBy: SortBy =
    search.sort === "followers" || search.sort === "name" ? search.sort : "nearest";
  const avail: "any" | "recruiting" | "weekly" | "casual" =
    search.avail === "recruiting" || search.avail === "weekly" || search.avail === "casual"
      ? search.avail
      : "any";
  const viewMode: ViewMode = search.view === "map" ? "map" : "list";
  const density: Density = search.density === "grid" ? "grid" : "list";

  const setQ = (v: string) => updateSearch({ q: v });
  const setSport = (v: Sport | null) => updateSearch({ sport: v ?? "" });
  const setSortBy = (v: SortBy) => updateSearch({ sort: v });
  const setAvail = (v: "any" | "recruiting" | "weekly" | "casual") => updateSearch({ avail: v });
  const [filtersOpen, setFiltersOpen] = useState(false);
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

  const list = useMemo(() => {
    const isRecruiting = (o: typeof orgs[number]) => {
      const pn = o.positionsNeeded;
      if (!pn) return false;
      return Object.values(pn).some((byPos) =>
        Object.values(byPos ?? {}).some((n) => Number(n) > 0),
      );
    };
    const cadenceMatches = (o: typeof orgs[number], target: "weekly" | "casual") => {
      const c = (o.cadence ?? "").toLowerCase();
      if (!c) return false;
      if (target === "weekly") return /week|multiple|daily/.test(c);
      return /month|casual|occasion|pickup|drop/.test(c);
    };
    const filtered = orgs
      .filter((o) => o.kind === "team")
      .filter((o) => (sport ? o.sports.includes(sport) : true))
      .filter((o) => {
        if (avail === "any") return true;
        if (avail === "recruiting") return isRecruiting(o);
        return cadenceMatches(o, avail);
      })
      .filter((o) =>
        q
          ? (o.name + o.handle + o.tagline + o.city + o.sports.join(" "))
              .toLowerCase()
              .includes(q.toLowerCase())
          : true,
      );
    const withDist = filtered.map((o) => ({ o, dist: pseudoDistance(o.id) }));
    withDist.sort((a, b) => {
      if (sortBy === "nearest") return a.dist - b.dist;
      if (sortBy === "followers") return b.o.followers - a.o.followers;
      return a.o.name.localeCompare(b.o.name);
    });
    return withDist;
  }, [orgs, sport, q, sortBy, avail]);

  const featured =
    orgs.find((o) => o.verified && o.kind === "team") ?? orgs.find((o) => o.kind === "team");

  return (
    <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 pt-6">
      <CommunityTabs />
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
        <h1 className="font-display text-3xl font-bold leading-tight">Teams & clubs.</h1>
        <p className="text-muted-foreground text-sm inline-flex items-center gap-1">
          {profile?.city ? (
            <>
              <MapPin className="h-3.5 w-3.5 text-lime" /> Nearest to {profile.city} ·{" "}
              {list.length} {list.length === 1 ? "result" : "results"}
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

      <div className="flex gap-2 mb-4">
        <div className="flex-1 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search teams, sport, city"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {(() => {
          const activeFilterCount = (sport ? 1 : 0) + (avail !== "any" ? 1 : 0);
          return (
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className={`relative grid h-11 w-11 place-items-center rounded-full border bg-surface ${activeFilterCount ? "border-lime" : "border-border"}`}
              aria-label="Filters"
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-lime text-[10px] font-bold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </button>
          );
        })()}
        <Link
          to="/teams/create"
          className="grid h-11 w-11 place-items-center rounded-full bg-lime-gradient text-primary-foreground glow-lime"
          aria-label="Create team"
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </Link>
      </div>

      {filtersOpen && (
        <>
          <div className="mb-3">
            <SportChips selected={sport} onSelect={(s) => setSport(s as Sport | null)} />
          </div>

          <div className="-mx-4 overflow-x-auto px-4 mb-4">
            <div className="flex gap-2 pb-1">
              {([
                { id: "any", label: "Any availability" },
                { id: "recruiting", label: "Recruiting" },
                { id: "weekly", label: "Weekly+" },
                { id: "casual", label: "Casual" },
              ] as const).map((a) => {
                const active = avail === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => setAvail(a.id)}
                    className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? "border-lime bg-lime text-primary-foreground"
                        : "border-border bg-surface text-muted-foreground"
                    }`}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {list.length} {list.length === 1 ? "result" : "results"}
        </span>
        <label className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="bg-transparent outline-none"
            aria-label="Sort teams"
          >
            <option value="nearest">Nearest</option>
            <option value="followers">Most followers</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
      </div>

      {viewMode === "map" ? (
        <TeamsMapView orgs={list.map((x) => x.o)} kind="team" />
      ) : (
        <div
          className={
            density === "grid"
              ? "grid grid-cols-1 sm:grid-cols-2 gap-3 pb-6"
              : "space-y-3 pb-6"
          }
        >
          {list.map(({ o, dist }, i) => (
            <div key={o.id} className="relative">
              <OrgCard org={o} index={i} />
              <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-background/70 backdrop-blur px-2 py-0.5 text-[10px] font-bold text-foreground">
                {dist} mi
              </span>
            </div>
          ))}
          {list.length === 0 && (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center text-muted-foreground sm:col-span-2">
              No teams match.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Megaphone, GraduationCap, MapPin, Building2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ListSkeleton } from "@/components/ui/loading-state";
import { FilterBar } from "@/components/FilterBar";
import { FilterSection, ChipRow } from "@/components/FilterSheet";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { type Sport } from "@/lib/sample-data";
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
import { TrainerActions } from "@/components/TrainerActions";
import { useMyProfile, useDistanceUnit } from "@/lib/user-prefs-store";
import { useAuth } from "@/hooks/use-auth";
import { usePersistedSearch } from "@/hooks/use-persisted-search";
import { toast } from "sonner";
import { SPORT_CONFIG, SESSION_TYPES } from "@/lib/sport-config";
import { haversineKm, KM_PER_MI, MI_PER_KM, useUserLocation } from "@/lib/geo";
import { filterTrainersByVenue } from "@/lib/trainer-feed-filter";
import { SortSection, SortSummary } from "@/components/filters/SortSection";
import { useQuery } from "@tanstack/react-query";
import { listTrainerIdsForOrg, listTrainerOrgs } from "@/lib/trainer-orgs.functions";
import {
  TRAINER_RATE_OPTIONS,
  compareByRateAsc,
  compareByRatingDesc,
  matchesMaxRate,
  parseMaxRate,
  withReviewStats,
} from "@/lib/trainer-directory";
import { useTrainerDirectoryData } from "@/lib/trainer-directory-data";
import { AGE_GROUPS, matchesAgeGroup, parseAgeGroup, type AgeGroupId } from "@/lib/age-groups";

import { Slider } from "@/components/ui/slider";

type SortBy = "nearest" | "soonest" | "followers" | "rate" | "rating" | "name";

const TRAINER_SORTS = [
  { value: "nearest" as const, label: "Nearest" },
  { value: "soonest" as const, label: "Soonest available" },
  { value: "followers" as const, label: "Most followers" },
  { value: "rating" as const, label: "Top rated" },
  { value: "rate" as const, label: "Lowest rate" },
  { value: "name" as const, label: "Name A–Z" },
];

type Avail = "any" | "soon" | "recruiting" | "weekly" | "casual";

// Lower = sooner. Used for the "Soonest available" sort.
function availabilityScore(o: {
  cadence?: string | null;
  positionsNeeded?: Record<string, Record<string, number>> | null;
}): number {
  const pn = o.positionsNeeded;
  const isBooking =
    !!pn &&
    Object.values(pn).some((byPos) => Object.values(byPos ?? {}).some((n) => Number(n) > 0));
  const c = (o.cadence ?? "").toLowerCase();
  if (isBooking) return 0;
  if (/on.?demand/.test(c)) return 1;
  if (/week/.test(c) && !/bi/.test(c)) return 2;
  if (/bi.?week/.test(c)) return 3;
  if (/month/.test(c)) return 4;
  if (/season/.test(c)) return 5;
  return 9;
}

function availabilityLabel(score: number): string {
  if (score === 0) return "Booking now";
  if (score === 1) return "On-demand";
  if (score === 2) return "This week";
  if (score === 3) return "Bi-weekly";
  if (score === 4) return "Monthly";
  if (score === 5) return "Seasonal";
  return "Ask";
}

function pseudoDistance(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return Math.round(((h % 400) / 10 + 0.3) * 10) / 10;
}

const trainersSearchSchema = z.object({
  mode: fallback(z.string(), "trainers").default("trainers"),
  q: fallback(z.string(), "").default(""),
  sport: fallback(z.string(), "").default(""),
  specialty: fallback(z.string(), "").default(""),
  venue: fallback(z.string(), "").default(""),
  orgId: fallback(z.string(), "").default(""),
  radius: fallback(z.coerce.number().min(0).max(200), 0).default(0),
  maxRate: fallback(z.coerce.number().min(0).max(1000), 0).default(0),
  age: fallback(z.string(), "").default(""),
  avail: fallback(z.string(), "any").default("any"),
  sort: fallback(z.string(), "nearest").default("nearest"),
  view: fallback(z.string(), "list").default("list"),
  density: fallback(z.string(), "list").default("list"),
});

export const Route = createFileRoute("/_tabs/trainers")({
  head: () =>
    pageHead({
      path: "/trainers",
      title: "Trainers & coaches — ballaCity",
      description:
        "Find and book trainers and coaches near you by sport, availability, and distance.",
      noindex: true,
    }),
  validateSearch: zodValidator(trainersSearchSchema),
  component: TrainersPage,
});

function TrainersPage() {
  const { user } = useAuth();
  const profile = useMyProfile(user);
  const search = Route.useSearch();
  type TrainersSearch = typeof search;
  const navigate = useNavigate({ from: "/trainers" });
  const updateSearch = (patch: Partial<TrainersSearch>) =>
    navigate({ search: (prev: TrainersSearch) => ({ ...prev, ...patch }), replace: true });
  const { hydrated } = usePersistedSearch("openrun:trainers-search", search, "/trainers", {
    q: "",
    mode: "trainers",
    sport: "",
    specialty: "",
    venue: "",
    orgId: "",
    radius: 0,
    maxRate: 0,
    age: "",
    avail: "any",
    sort: "nearest",
    view: "list",
    density: "list",
  });

  const mode: "trainers" | "gyms" = search.mode === "gyms" ? "gyms" : "trainers";
  const q = search.q;
  const sports = useMemo(() => parseSportList(search.sport), [search.sport]);
  const specialty: string = search.specialty || "";
  const venue: string = search.venue || "";
  const orgId: string = search.orgId || "";
  const radius: number = Number(search.radius) || 0;
  const maxRate = parseMaxRate(search.maxRate);
  const ageGroup = parseAgeGroup(search.age);
  const sortBy: SortBy =
    search.sort === "soonest" ||
    search.sort === "followers" ||
    search.sort === "rate" ||
    search.sort === "rating" ||
    search.sort === "name"
      ? search.sort
      : "nearest";
  const avail: Avail =
    search.avail === "soon" ||
    search.avail === "recruiting" ||
    search.avail === "weekly" ||
    search.avail === "casual"
      ? search.avail
      : "any";
  const viewMode: ViewMode = search.view === "map" ? "map" : "list";
  const density: Density = search.density === "grid" ? "grid" : "list";

  const distanceUnit = useDistanceUnit();
  const unitLabel = distanceUnit === "km" ? "km" : "mi";
  const { coords, status: geoStatus, request: requestLocation } = useUserLocation();
  const radiusKm = radius > 0 ? (distanceUnit === "km" ? radius : radius * KM_PER_MI) : 0;

  const setQ = (v: string) => updateSearch({ q: v });
  const toggleSportFilter = (v: string | null) => {
    markSportChoice("trainers");
    updateSearch({ sport: serializeSportList(toggleSport(sports, v)), specialty: "" });
  };
  // Default to the viewer's profile sports until they pick for themselves.
  useProfileSportDefault("trainers", {
    ready: hydrated,
    current: sports,
    apply: (next) => updateSearch({ sport: serializeSportList(next) }),
  });
  const setSpecialty = (v: string) => updateSearch({ specialty: specialty === v ? "" : v });
  const setVenue = (v: string) => updateSearch({ venue: venue === v ? "" : v });
  const setOrgId = (v: string) => updateSearch({ orgId: orgId === v ? "" : v });

  const orgsListQuery = useQuery({
    queryKey: ["trainer-orgs-list"],
    queryFn: () => listTrainerOrgs({ data: {} }),
  });
  const orgMembersQuery = useQuery({
    queryKey: ["trainer-org-members", orgId],
    queryFn: () => listTrainerIdsForOrg({ data: { orgId } }),
    enabled: !!orgId,
  });
  const orgMemberIds = useMemo(() => new Set(orgMembersQuery.data ?? []), [orgMembersQuery.data]);
  const setRadius = (v: number) => updateSearch({ radius: v });
  const setSortBy = (v: SortBy) => updateSearch({ sort: v });
  const setAvail = (v: Avail) => updateSearch({ avail: v });
  const setMaxRate = (v: string) => updateSearch({ maxRate: parseMaxRate(v) });
  const setAgeGroup = (v: AgeGroupId | "") => updateSearch({ age: v });

  const [filtersOpen, setFiltersOpen] = useState(false);
  const switchView = (v: ViewMode) => updateSearch({ view: v });
  const switchDensity = (d: Density) => updateSearch({ density: d });

  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current) return;
    migratedRef.current = true;
    if (typeof window === "undefined") return;
    try {
      const hasSearch = window.location.search.length > 1;
      const rawV = window.localStorage.getItem("openrun:trainers-view");
      const rawD = window.localStorage.getItem("openrun:trainers-density");
      if (!hasSearch && (rawV || rawD)) {
        const patch: Partial<TrainersSearch> = {};
        if (rawV === "map" || rawV === "list") patch.view = rawV;
        if (rawD === "grid" || rawD === "list") patch.density = rawD;
        if (Object.keys(patch).length > 0) {
          navigate({ search: (prev: TrainersSearch) => ({ ...prev, ...patch }), replace: true });
        }
      }
      window.localStorage.removeItem("openrun:trainers-view");
      window.localStorage.removeItem("openrun:trainers-density");
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const orgs = useAllOrgs();

  // Real ratings and the facility each trainer works at, fetched once for the
  // whole page (not per card).
  const { ratings, facilities } = useTrainerDirectoryData(
    orgs.filter((o) => o.kind === "coach").map((o) => o.id),
  );

  // Real-time availability change indicator
  const trainerSig = useMemo(
    () =>
      orgs
        .filter((o) => o.kind === "coach")
        .map((o) => `${o.id}:${o.cadence ?? ""}:${JSON.stringify(o.positionsNeeded ?? {})}`)
        .join("|"),
    [orgs],
  );
  const prevSigRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSigRef.current !== null && prevSigRef.current !== trainerSig) {
      toast("Trainer availability updated", { duration: 2000 });
    }
    prevSigRef.current = trainerSig;
  }, [trainerSig]);

  const list = useMemo(() => {
    const isBooking = (o: (typeof orgs)[number]) => {
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
    const specialtyLower = specialty.toLowerCase();
    const byVenue = filterTrainersByVenue(orgs, venue);
    const byOrg = orgId ? byVenue.filter((o) => orgMemberIds.has(o.id)) : byVenue;
    const filtered = byOrg
      .filter((o) => matchesSportList(o.sports, sports))
      .filter((o) => matchesMaxRate(o.ratePerHour, maxRate))
      .filter((o) => matchesAgeGroup(o.ageGroups, ageGroup))
      .filter((o) => {
        if (!specialty) return true;
        const hay = `${o.tagline ?? ""} ${o.name ?? ""}`.toLowerCase();
        return hay.includes(specialtyLower);
      })

      .filter((o) => {
        if (avail === "any") return true;
        if (avail === "recruiting") return isBooking(o);
        if (avail === "soon") return availabilityScore(o) <= 2;
        return cadenceMatches(o, avail);
      })
      .filter((o) =>
        q
          ? (o.name + o.handle + o.tagline + o.city + o.sports.join(" "))
              .toLowerCase()
              .includes(q.toLowerCase())
          : true,
      );
    const withDist = filtered
      .map((rawOrg) => {
        // Real review stats replace a missing (or stale) rating.
        const o = withReviewStats(rawOrg, ratings.get(rawOrg.id));
        let minKm: number | null = null;
        if (coords && (o.venueGeo?.length ?? 0) > 0) {
          for (const g of o.venueGeo ?? []) {
            const d = haversineKm(coords, { lat: g.lat, lng: g.lng });
            if (minKm == null || d < minKm) minKm = d;
          }
        }
        return {
          o,
          dist: pseudoDistance(o.id),
          score: availabilityScore(o),
          minKm,
        };
      })
      .filter((x) => {
        if (radiusKm <= 0 || !coords) return true;
        return x.minKm != null && x.minKm <= radiusKm;
      });
    withDist.sort((a, b) => {
      if (sortBy === "nearest") {
        if (radiusKm > 0 && coords) {
          const ax = a.minKm ?? Infinity;
          const bx = b.minKm ?? Infinity;
          if (ax !== bx) return ax - bx;
        }
        return a.dist - b.dist;
      }
      if (sortBy === "soonest") return a.score - b.score || a.dist - b.dist;
      if (sortBy === "followers") return b.o.followers - a.o.followers;
      if (sortBy === "rating") return compareByRatingDesc(a.o, b.o) || a.dist - b.dist;
      if (sortBy === "rate") return compareByRateAsc(a.o, b.o) || a.dist - b.dist;
      return a.o.name.localeCompare(b.o.name);
    });
    return withDist;
  }, [
    orgs,
    sports,
    specialty,
    venue,
    orgId,
    orgMemberIds,
    q,
    sortBy,
    avail,
    radiusKm,
    coords,
    maxRate,
    ageGroup,
    ratings,
  ]);

  const venueOptions = useMemo(() => {
    const map = new Map<string, { addr: string; primary: boolean; count: number }>();
    orgs
      .filter((o) => o.kind === "coach")
      .forEach((o) => {
        const primary = o.primaryVenue?.trim() ?? "";
        (o.venueAddresses ?? []).forEach((a) => {
          const trimmed = a.trim();
          if (!trimmed) return;
          const key = trimmed.toLowerCase();
          const isPrimary = !!primary && primary === trimmed;
          const cur = map.get(key);
          if (cur) {
            cur.count += 1;
            cur.primary = cur.primary || isPrimary;
          } else {
            map.set(key, { addr: trimmed, primary: isPrimary, count: 1 });
          }
        });
      });
    return Array.from(map.values()).sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      if (b.count !== a.count) return b.count - a.count;
      return a.addr.localeCompare(b.addr);
    });
  }, [orgs]);

  const featured =
    orgs.find((o) => o.verified && o.kind === "coach") ?? orgs.find((o) => o.kind === "coach");

  const gymsList = useMemo(() => {
    const rows = orgsListQuery.data ?? [];
    const ql = q.trim().toLowerCase();
    const filtered = ql
      ? rows.filter((o) =>
          `${o.name ?? ""} ${o.handle ?? ""} ${o.city ?? ""} ${o.bio ?? ""}`
            .toLowerCase()
            .includes(ql),
        )
      : rows;
    return [...filtered].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [orgsListQuery.data, q]);

  return (
    <div className="page-shell-content pt-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
        <h1 className="page-title">
          {mode === "gyms" ? "Gyms & organizations." : "Trainers & gyms."}
        </h1>
        <p className="text-muted-foreground text-sm inline-flex items-center gap-1">
          {mode === "gyms" ? (
            <>
              {gymsList.length} {gymsList.length === 1 ? "gym" : "gyms"}
              {profile?.city ? <> · near {profile.city}</> : null}
            </>
          ) : profile?.city ? (
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

      {/* Trainers / Gyms tabs */}
      <div className="mb-4 inline-flex rounded-full border border-border bg-surface p-1 text-xs font-bold">
        {(
          [
            { id: "trainers", label: "Trainers", Icon: GraduationCap },
            { id: "gyms", label: "Gyms", Icon: Building2 },
          ] as const
        ).map((t) => {
          const active = mode === t.id;
          return (
            <button
              key={t.id}
              onClick={() =>
                updateSearch({
                  mode: t.id,
                  // reset trainer-only filters when switching
                  ...(t.id === "gyms"
                    ? {
                        sport: "",
                        specialty: "",
                        venue: "",
                        orgId: "",
                        avail: "any",
                        radius: 0,
                        age: "",
                      }
                    : {}),
                })
              }
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-colors ${
                active
                  ? "bg-lime text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={active}
            >
              <t.Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {mode === "trainers" && featured && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative mb-5 overflow-hidden rounded-3xl border border-lime/30 bg-surface"
        >
          <img src={featured.cover} alt="" className="h-32 w-full object-cover opacity-50" />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
          <div className="absolute inset-0 p-4 flex flex-col justify-end">
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime uppercase tracking-wider">
              <Megaphone className="h-3 w-3" /> Booking · clinics open
            </span>
            <div className="mt-1 font-display text-xl font-bold">{featured.name} · Now Booking</div>
            <div className="text-xs text-muted-foreground">{featured.tagline}</div>
          </div>
        </motion.div>
      )}

      {mode === "gyms" ? (
        <GymsView gyms={gymsList} q={q} onQ={setQ} isLoading={orgsListQuery.isLoading} />
      ) : (
        <TrainersView />
      )}
    </div>
  );

  function TrainersView() {
    return (
      <>
        <ViewDensityToggle
          view={viewMode}
          onViewChange={switchView}
          density={density}
          onDensityChange={switchDensity}
        />

        {(() => {
          const activeFilterCount =
            (sports.length ? 1 : 0) +
            (specialty ? 1 : 0) +
            (venue ? 1 : 0) +
            (orgId ? 1 : 0) +
            (radius > 0 ? 1 : 0) +
            (maxRate > 0 ? 1 : 0) +
            (ageGroup ? 1 : 0) +
            (avail !== "any" ? 1 : 0) +
            (sortBy !== "nearest" ? 1 : 0);
          const specialties = sports.length
            ? Array.from(
                new Set(
                  sports.flatMap((sp) => SPORT_CONFIG[sp as Sport]?.formats ?? ([] as string[])),
                ),
              )
            : SESSION_TYPES;
          return (
            <FilterBar
              q={q}
              onQChange={setQ}
              searchPlaceholder="Search trainers, sport, credential"
              activeFilterCount={activeFilterCount}
              create={{ to: "/trainers/create", label: "Create trainer profile" }}
              sheetTitle="Filter trainers"
              onReset={() =>
                updateSearch({
                  sport: "",
                  specialty: "",
                  venue: "",
                  orgId: "",
                  radius: 0,
                  maxRate: 0,
                  age: "",
                  avail: "any",
                  sort: "nearest",
                })
              }
              resetDisabled={activeFilterCount === 0}
              sheet={
                <>
                  <FilterSection label="Sports">
                    <SportChips multi selected={sports} onSelect={toggleSportFilter} />
                  </FilterSection>

                  <FilterSection label="Specialty">
                    <div className="flex flex-wrap gap-2">
                      {specialties.map((s) => {
                        const active = specialty === s;
                        return (
                          <button
                            key={s}
                            onClick={() => setSpecialty(s)}
                            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                              active
                                ? "border-lime bg-lime text-primary-foreground"
                                : "border-border bg-background text-muted-foreground"
                            }`}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </FilterSection>

                  {venueOptions.length > 0 && (
                    <FilterSection label="Venue">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setVenue("")}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            !venue
                              ? "border-lime bg-lime text-primary-foreground"
                              : "border-border bg-background text-muted-foreground"
                          }`}
                        >
                          Any venue
                        </button>
                        {venueOptions.map((v) => {
                          const active = venue.trim().toLowerCase() === v.addr.toLowerCase();
                          const short = v.addr.split(",")[0];
                          return (
                            <button
                              key={v.addr}
                              onClick={() => setVenue(v.addr)}
                              title={v.addr}
                              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                                active
                                  ? "border-lime bg-lime text-primary-foreground"
                                  : "border-border bg-background text-muted-foreground"
                              }`}
                            >
                              {v.primary ? "★ " : ""}
                              {short}
                            </button>
                          );
                        })}
                      </div>
                    </FilterSection>
                  )}

                  {(orgsListQuery.data ?? []).length > 0 && (
                    <FilterSection label="Gym">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setOrgId("")}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            !orgId
                              ? "border-lime bg-lime text-primary-foreground"
                              : "border-border bg-background text-muted-foreground"
                          }`}
                        >
                          Any org
                        </button>
                        {(orgsListQuery.data ?? []).map((o) => {
                          const active = orgId === o.id;
                          return (
                            <button
                              key={o.id}
                              onClick={() => setOrgId(o.id)}
                              title={o.name}
                              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                                active
                                  ? "border-lime bg-lime text-primary-foreground"
                                  : "border-border bg-background text-muted-foreground"
                              }`}
                            >
                              {o.verified ? "✓ " : ""}
                              {o.name}
                            </button>
                          );
                        })}
                      </div>
                    </FilterSection>
                  )}

                  <FilterSection
                    label="Distance"
                    hint={radius > 0 ? `Within ${radius} ${unitLabel}` : "Any distance"}
                  >
                    <Slider
                      value={[radius]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={(v) => {
                        const nv = Math.round(v[0] ?? 0);
                        setRadius(nv);
                        if (nv > 0 && geoStatus !== "granted" && geoStatus !== "prompting") {
                          requestLocation();
                        }
                      }}
                      aria-label="Distance radius"
                    />
                    {radius > 0 && geoStatus !== "granted" && (
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-muted-foreground">
                          {geoStatus === "denied" || geoStatus === "unsupported"
                            ? "Location unavailable — enable location to filter by distance."
                            : "Share your location to filter by distance."}
                        </span>
                        <button
                          onClick={requestLocation}
                          className="whitespace-nowrap rounded-full border border-lime bg-lime/10 px-2.5 py-1 text-[11px] font-bold text-lime"
                        >
                          {geoStatus === "prompting" ? "Locating…" : "Use my location"}
                        </button>
                      </div>
                    )}
                  </FilterSection>

                  <FilterSection
                    label="Hourly rate"
                    hint={maxRate > 0 ? `Up to $${maxRate}/hr` : "Any rate"}
                  >
                    <ChipRow
                      value={String(maxRate)}
                      onChange={setMaxRate}
                      options={TRAINER_RATE_OPTIONS.map((o) => ({
                        value: o.value,
                        label: o.label,
                      }))}
                    />
                  </FilterSection>

                  <FilterSection
                    label="Age group"
                    hint="Only trainers who listed an age group are shown"
                  >
                    <ChipRow<AgeGroupId | "">
                      value={ageGroup}
                      onChange={setAgeGroup}
                      options={[
                        { value: "", label: "Any age" },
                        ...AGE_GROUPS.map((g) => ({ value: g.id, label: g.label })),
                      ]}
                    />
                  </FilterSection>

                  <FilterSection label="Availability">
                    <ChipRow
                      value={avail}
                      onChange={setAvail}
                      options={[
                        { value: "any", label: "Any time" },
                        { value: "recruiting", label: "Booking now" },
                        { value: "soon", label: "This week" },
                        { value: "weekly", label: "Weekly+" },
                        { value: "casual", label: "Casual" },
                      ]}
                    />
                  </FilterSection>

                  <SortSection value={sortBy} onChange={setSortBy} options={TRAINER_SORTS} />
                </>
              }
            />
          );
        })()}

        <div className="mb-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {list.length} {list.length === 1 ? "result" : "results"}
          </span>
          <SortSummary value={sortBy} options={TRAINER_SORTS} />
        </div>

        {viewMode === "map" ? (
          <TeamsMapView orgs={list.map((x) => x.o)} kind="coach" />
        ) : (
          <div
            className={
              density === "grid" ? "grid grid-cols-1 sm:grid-cols-2 gap-3 pb-6" : "space-y-3 pb-6"
            }
          >
            {list.map(({ o, dist, score, minKm }, i) => {
              const distLabel =
                radiusKm > 0 && coords && minKm != null
                  ? distanceUnit === "km"
                    ? `${minKm.toFixed(1)} km`
                    : `${(minKm * MI_PER_KM).toFixed(1)} mi`
                  : `${dist} mi`;
              const venueOffered =
                !!venue &&
                (o.venueAddresses ?? []).some(
                  (a) => a.trim().toLowerCase() === venue.trim().toLowerCase(),
                );
              const cardSearch = venueOffered ? { venue } : undefined;
              return (
                <div key={o.id} className="relative">
                  <OrgCard
                    org={o}
                    index={i}
                    search={cardSearch}
                    facility={facilities[o.id] ?? null}
                  />
                  <div className="pointer-events-none absolute top-3 right-3 flex flex-col items-end gap-1">
                    <span className="rounded-full bg-background/70 backdrop-blur px-2 py-0.5 text-[10px] font-bold text-foreground">
                      {distLabel}
                    </span>
                    <span
                      className={`rounded-full backdrop-blur px-2 py-0.5 text-[10px] font-bold ${
                        score === 0
                          ? "bg-lime text-primary-foreground"
                          : score <= 2
                            ? "bg-lime/20 text-lime"
                            : "bg-background/70 text-muted-foreground"
                      }`}
                    >
                      {availabilityLabel(score)}
                    </span>
                  </div>
                  <TrainerActions org={o} defaultVenue={venue || null} />
                </div>
              );
            })}
            {list.length === 0 && (
              <EmptyState
                className="sm:col-span-2"
                icon={<GraduationCap className="h-6 w-6" aria-hidden />}
                title="No trainers match your filters"
                description="Widen the distance or pick another sport to see more coaches near you."
              />
            )}
          </div>
        )}
      </>
    );
  }
}

function GymsView({
  gyms,
  q,
  onQ,
  isLoading,
}: {
  gyms: Array<{
    id: string;
    name: string;
    handle: string;
    avatar: string | null;
    city: string | null;
    bio: string | null;
    verified: boolean;
  }>;
  q: string;
  onQ: (v: string) => void;
  isLoading: boolean;
}) {
  return (
    <>
      <FilterBar
        q={q}
        onQChange={onQ}
        searchPlaceholder="Search gyms by name, handle, city"
        create={{ to: "/orgs/create", label: "Create a gym or organization" }}
        sheetTitle="Filter gyms"
        sheet={<div className="text-sm text-muted-foreground">More gym filters coming soon.</div>}
      />

      {isLoading ? (
        <ListSkeleton rows={3} label="Loading gyms…" />
      ) : gyms.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-6 w-6" aria-hidden />}
          title="No gyms listed yet"
          description="Gyms and organizations near you will appear here. You can add yours in a minute."
          action={
            <Link
              to="/orgs/create"
              className="inline-flex rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-primary-foreground"
            >
              Add a gym
            </Link>
          }
        />
      ) : (
        <div className="space-y-3 pb-6">
          {gyms.map((g) => (
            <Link
              key={g.id}
              to="/orgs/$orgId"
              params={{ orgId: g.id }}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 transition-colors hover:border-lime/40"
            >
              <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border bg-lime-gradient font-display text-base font-bold text-primary-foreground">
                {g.avatar && (g.avatar.startsWith("http") || g.avatar.startsWith("/")) ? (
                  <img src={g.avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  (g.avatar || g.name.slice(0, 2)).toUpperCase().slice(0, 3)
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-display text-base font-bold">{g.name}</span>
                  {g.verified && (
                    <span className="rounded-full bg-lime/15 px-1.5 py-0.5 micro-label text-lime">
                      ✓
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  @{g.handle}
                  {g.city ? <> · {g.city}</> : null}
                </div>
                {g.bio && (
                  <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/80">
                    {g.bio}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { matchesOrgQuery } from "@/lib/org-search";
import { pageHead } from "@/lib/seo";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Megaphone, GraduationCap, MapPin } from "lucide-react";
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
import { KM_PER_MI, MI_PER_KM, useUserLocation } from "@/lib/geo";
import { orgDistance } from "@/lib/org-distance";
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
import { PreviewGate } from "@/components/public/PreviewGate";

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
      title: "Trainers & coaches — BallaCity",
      description:
        "Find and book trainers and coaches near you by sport, availability, and distance.",
      noindex: true,
    }),
  validateSearch: zodValidator(trainersSearchSchema),
  // Venues have their own directory (the strip's Venues tab). Older links and
  // bookmarks to this page's venue view land there, keeping any search text.
  beforeLoad: ({ search }) => {
    if (search.mode === "gyms") {
      throw redirect({ to: "/orgs", search: search.q ? { q: search.q } : {}, replace: true });
    }
  },
  component: TrainersPageGate,
});

/** A signed-out visitor gets a blurred sample preview; the real page mounts only for a member. */
function TrainersPageGate() {
  return (
    <PreviewGate tab="trainers">
      <TrainersPage />
    </PreviewGate>
  );
}

function TrainersPage() {
  const { user } = useAuth();
  const profile = useMyProfile(user);
  const search = Route.useSearch();
  type TrainersSearch = typeof search;
  const navigate = useNavigate({ from: "/trainers" });
  const updateSearch = (patch: Partial<TrainersSearch>) =>
    navigate({ search: (prev: TrainersSearch) => ({ ...prev, ...patch }), replace: true });
  const { hydrated } = usePersistedSearch("openrun:trainers-search-v2", search, "/trainers", {
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
      .filter((o) => matchesOrgQuery(o, q));
    const withDist = filtered
      .map((rawOrg) => {
        // Real review stats replace a missing (or stale) rating.
        const o = withReviewStats(rawOrg, ratings.get(rawOrg.id));
        const measured = orgDistance(o, coords);
        return {
          o,
          dist: measured,
          score: availabilityScore(o),
          minKm: measured ? measured.mi * KM_PER_MI : null,
        };
      })
      .filter((x) => {
        if (radiusKm <= 0 || !coords) return true;
        return x.minKm != null && x.minKm <= radiusKm;
      });
    withDist.sort((a, b) => {
      // Trainers we can't measure sort last within any distance tie-break.
      const byDistance = () => (a.minKm ?? Infinity) - (b.minKm ?? Infinity) || 0;
      if (sortBy === "nearest") {
        return byDistance() || a.o.name.localeCompare(b.o.name);
      }
      if (sortBy === "soonest") return a.score - b.score || byDistance();
      if (sortBy === "followers") return b.o.followers - a.o.followers;
      if (sortBy === "rating") return compareByRatingDesc(a.o, b.o) || byDistance();
      if (sortBy === "rate") return compareByRateAsc(a.o, b.o) || byDistance();
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

  return (
    <div className="page-shell-content pt-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
        <h1 className="page-title">Trainers.</h1>
        <p className="text-muted-foreground text-sm inline-flex items-center gap-1">
          {coords && sortBy === "nearest" ? (
            <>
              <MapPin className="h-3.5 w-3.5 text-lime" /> Nearest to {profile?.city || "you"} ·{" "}
              {list.length} {list.length === 1 ? "result" : "results"}
            </>
          ) : (
            <>
              {list.length} {list.length === 1 ? "result" : "results"}
              {!profile?.city && !coords ? (
                <>
                  {" "}
                  ·{" "}
                  <Link to="/profile/edit" className="text-lime font-semibold">
                    Set your city
                  </Link>{" "}
                  for nearby
                </>
              ) : null}
            </>
          )}
        </p>
      </motion.div>

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
              <Megaphone className="h-3 w-3" /> Booking · clinics open
            </span>
            <div className="mt-1 font-display text-xl font-bold">{featured.name} · Now Booking</div>
            <div className="text-xs text-muted-foreground">{featured.tagline}</div>
          </div>
        </motion.div>
      )}

      <TrainersView />
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
                minKm == null
                  ? null
                  : `${dist?.approx ? "~" : ""}${
                      distanceUnit === "km"
                        ? `${minKm.toFixed(1)} km`
                        : `${(minKm * MI_PER_KM).toFixed(1)} mi`
                    }`;
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
                    {distLabel && (
                      <span className="rounded-full bg-background/70 backdrop-blur px-2 py-0.5 text-[10px] font-bold text-foreground">
                        {distLabel}
                      </span>
                    )}
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

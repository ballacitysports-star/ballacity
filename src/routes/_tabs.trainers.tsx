import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Search, Plus, Megaphone, GraduationCap, ArrowUpDown, MapPin, SlidersHorizontal } from "lucide-react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { type Sport } from "@/lib/sample-data";
import { useAllOrgs } from "@/lib/org-store";
import { OrgCard } from "@/components/OrgCard";
import { SportChips } from "@/components/SportChips";
import { ViewDensityToggle, type ViewMode, type Density } from "@/components/ViewDensityToggle";
import { TeamsMapView } from "@/components/TeamsMapView";
import { TrainerActions } from "@/components/TrainerActions";
import { useMyProfile, useFeedPrefs } from "@/lib/user-prefs-store";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { SPORT_CONFIG, SESSION_TYPES } from "@/lib/sport-config";
import { haversineKm, KM_PER_MI, MI_PER_KM, useUserLocation } from "@/lib/geo";
import { filterTrainersByVenue } from "@/lib/trainer-feed-filter";
import { useQuery } from "@tanstack/react-query";
import { listTrainerIdsForOrg, listTrainerOrgs } from "@/lib/trainer-orgs.functions";

import { Slider } from "@/components/ui/slider";

type SortBy = "nearest" | "soonest" | "followers" | "name";
type Avail = "any" | "soon" | "recruiting" | "weekly" | "casual";

// Lower = sooner. Used for the "Soonest available" sort.
function availabilityScore(o: {
  cadence?: string | null;
  positionsNeeded?: Record<string, Record<string, number>> | null;
}): number {
  const pn = o.positionsNeeded;
  const isBooking =
    !!pn &&
    Object.values(pn).some((byPos) =>
      Object.values(byPos ?? {}).some((n) => Number(n) > 0),
    );
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
  q: fallback(z.string(), "").default(""),
  sport: fallback(z.string(), "").default(""),
  specialty: fallback(z.string(), "").default(""),
  venue: fallback(z.string(), "").default(""),
  orgId: fallback(z.string(), "").default(""),
  radius: fallback(z.coerce.number().min(0).max(200), 0).default(0),
  avail: fallback(z.string(), "any").default("any"),
  sort: fallback(z.string(), "nearest").default("nearest"),
  view: fallback(z.string(), "list").default("list"),
  density: fallback(z.string(), "list").default("list"),
});


export const Route = createFileRoute("/_tabs/trainers")({
  head: () => ({
    meta: [
      { title: "Trainers & coaches — OpenRun" },
      { name: "description", content: "Find and book trainers and coaches near you. Filter by sport, availability, and distance." },
      { property: "og:title", content: "Trainers & coaches — OpenRun" },
      { property: "og:description", content: "Find and book trainers and coaches near you." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
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

  const q = search.q;
  const sport: Sport | null = (search.sport || null) as Sport | null;
  const specialty: string = search.specialty || "";
  const venue: string = search.venue || "";
  const orgId: string = search.orgId || "";
  const radius: number = Number(search.radius) || 0;
  const sortBy: SortBy =
    search.sort === "soonest" || search.sort === "followers" || search.sort === "name"
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

  const { distanceUnit } = useFeedPrefs();
  const unitLabel = distanceUnit === "km" ? "km" : "mi";
  const { coords, status: geoStatus, request: requestLocation } = useUserLocation();
  const radiusKm = radius > 0 ? (distanceUnit === "km" ? radius : radius * KM_PER_MI) : 0;

  const setQ = (v: string) => updateSearch({ q: v });
  const setSport = (v: Sport | null) => updateSearch({ sport: v ?? "", specialty: "" });
  const setSpecialty = (v: string) =>
    updateSearch({ specialty: specialty === v ? "" : v });
  const setVenue = (v: string) => updateSearch({ venue: venue === v ? "" : v });
  const setRadius = (v: number) => updateSearch({ radius: v });
  const setSortBy = (v: SortBy) => updateSearch({ sort: v });
  const setAvail = (v: Avail) => updateSearch({ avail: v });

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
    const isBooking = (o: typeof orgs[number]) => {
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
    const specialtyLower = specialty.toLowerCase();
    const byVenue = filterTrainersByVenue(orgs, venue);
    const filtered = byVenue
      .filter((o) => (sport ? o.sports.includes(sport) : true))
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
      .map((o) => {
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
      return a.o.name.localeCompare(b.o.name);
    });
    return withDist;
  }, [orgs, sport, specialty, venue, q, sortBy, avail, radiusKm, coords]);

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
    <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 pt-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
        <h1 className="font-display text-3xl font-bold leading-tight">Trainers & coaches.</h1>
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
            <div className="mt-1 font-display text-xl font-bold">
              {featured.name} · Now Booking
            </div>
            <div className="text-xs text-muted-foreground">{featured.tagline}</div>
          </div>
        </motion.div>
      )}

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
            placeholder="Search trainers, sport, credential"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {(() => {
          const activeFilterCount =
            (sport ? 1 : 0) + (specialty ? 1 : 0) + (venue ? 1 : 0) + (radius > 0 ? 1 : 0) + (avail !== "any" ? 1 : 0);

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
          to="/trainers/create"
          className="grid h-11 w-11 place-items-center rounded-full bg-lime-gradient text-primary-foreground glow-lime"
          aria-label="Create trainer profile"
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </Link>
      </div>

      {filtersOpen && (
        <>
          <div className="mb-3">
            <SportChips selected={sport} onSelect={(s) => setSport(s as Sport | null)} />
          </div>

          {(() => {
            const specialties = sport
              ? SPORT_CONFIG[sport].formats
              : SESSION_TYPES;
            return (
              <div className="-mx-4 overflow-x-auto px-4 mb-3">
                <div className="flex gap-2 pb-1">
                  <span className="self-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground pr-1">
                    Specialty
                  </span>
                  {specialties.map((s) => {
                    const active = specialty === s;
                    return (
                      <button
                        key={s}
                        onClick={() => setSpecialty(s)}
                        className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          active
                            ? "border-lime bg-lime text-primary-foreground"
                            : "border-border bg-surface text-muted-foreground"
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {venueOptions.length > 0 && (
            <div className="-mx-4 overflow-x-auto px-4 mb-3">
              <div className="flex gap-2 pb-1">
                <span className="self-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground pr-1">
                  Venue
                </span>
                <button
                  onClick={() => setVenue("")}
                  className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    !venue
                      ? "border-lime bg-lime text-primary-foreground"
                      : "border-border bg-surface text-muted-foreground"
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
                      className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        active
                          ? "border-lime bg-lime text-primary-foreground"
                          : "border-border bg-surface text-muted-foreground"
                      }`}
                    >
                      {v.primary ? "★ " : ""}
                      {short}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mb-4 rounded-2xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-lime" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Within
                </span>
                <span className="text-xs font-semibold">
                  {radius > 0 ? `${radius} ${unitLabel}` : "Any distance"}
                </span>
              </div>
              {radius > 0 && (
                <button
                  onClick={() => setRadius(0)}
                  className="text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
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
          </div>




          <div className="-mx-4 overflow-x-auto px-4 mb-4">
            <div className="flex gap-2 pb-1">
              <span className="self-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground pr-1">
                Available
              </span>
              {([
                { id: "any", label: "Any time" },
                { id: "recruiting", label: "Booking now" },
                { id: "soon", label: "This week" },
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
            aria-label="Sort trainers"
          >
            <option value="nearest">Nearest</option>
            <option value="soonest">Soonest available</option>
            <option value="followers">Most followers</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
      </div>

      {viewMode === "map" ? (
        <TeamsMapView orgs={list.map((x) => x.o)} kind="coach" />
      ) : (
        <div
          className={
            density === "grid"
              ? "grid grid-cols-1 sm:grid-cols-2 gap-3 pb-6"
              : "space-y-3 pb-6"
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
                <OrgCard org={o} index={i} search={cardSearch} />
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
            <div className="rounded-2xl border border-border bg-surface p-8 text-center text-muted-foreground sm:col-span-2">
              <div className="inline-flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-lime" />
                No trainers match.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

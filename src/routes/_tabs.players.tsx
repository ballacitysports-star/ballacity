import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import {
  Search,
  X,
  Plus,
  MessageCircle,
  Send,
  Calendar,
  MapPin,
  Bell,
  Inbox,
  Loader2,
  SlidersHorizontal,
  Ticket,
} from "lucide-react";
import { ViewDensityToggle, type ViewMode, type Density } from "@/components/ViewDensityToggle";
import { CommunityTabs } from "@/components/CommunityTabs";
import { PlayersMapView } from "@/components/PlayersMapView";
import { AnimatePresence } from "framer-motion";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { SportChips } from "@/components/SportChips";
import { MyAvatar, UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadNotificationCount } from "@/lib/notifications";
import { SPORTS } from "@/lib/sample-data";
import {
  type AvailabilityWithAuthor,
  createAvailability,
  createContactRequest,
  deleteAvailability,
  listOpenAvailabilities,
  type PlayerAvailability,
  type ExistingRequestSummary,
} from "@/lib/availability";
import { RequestStatusPanel } from "@/components/RequestStatusPanel";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { useHostedGames } from "@/lib/hosted-games-store";
import type { Game } from "@/lib/sample-data";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { kmToMi, miToKm } from "@/lib/distance";
import { useMyProfile } from "@/lib/user-prefs-store";

// URL-persisted Players state. Refreshing or sharing the URL restores the
// exact view: search text, sport chip, skill, distance cap, age range,
// when-filter, and the view/density toggles. Invalid values silently
// revert to defaults per zod-adapter fallback().
const playersSearchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  sport: fallback(z.string(), "").default(""),
  skill: fallback(z.string(), "").default(""),
  dist: fallback(z.number(), 0).default(0),
  ageMin: fallback(z.number().optional(), undefined).default(undefined),
  ageMax: fallback(z.number().optional(), undefined).default(undefined),
  unknownAge: fallback(z.boolean(), true).default(true),
  when: fallback(z.string(), "any").default("any"),
  view: fallback(z.string(), "list").default("list"),
  density: fallback(z.string(), "list").default("list"),
});

export const Route = createFileRoute("/_tabs/players")({
  head: () => ({ meta: [{ title: "Players — OpenRun" }] }),
  validateSearch: zodValidator(playersSearchSchema),
  component: PlayersPage,
});

const SKILLS = ["All Levels", "Beginner", "Intermediate", "Advanced"] as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];


function PlayersPage() {
  const { user } = useAuth();
  const profile = useMyProfile(user);
  const hostedGames = useHostedGames();

  const myUpcomingHosted = useMemo(() => {
    if (!user) return [];
    const now = Date.now();
    return hostedGames
      .filter(
        (g) => g.hostUserId === user.id && new Date(g.date).getTime() > now - 3 * 60 * 60 * 1000,
      )
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [hostedGames, user?.id]);
  const search = Route.useSearch();
  type PlayersSearch = typeof search;
  const navigate = useNavigate({ from: "/players" });
  const updateSearch = (patch: Partial<PlayersSearch>) =>
    navigate({ search: (prev: PlayersSearch) => ({ ...prev, ...patch }), replace: true });

  const q = search.q;
  const sport = search.sport;
  const skill = search.skill;
  const maxDistance = search.dist;
  const ageMin: number | "" = search.ageMin ?? "";
  const ageMax: number | "" = search.ageMax ?? "";
  const includeUnknownAge = search.unknownAge;
  const when: "any" | "today" | "week" | "weekend" =
    search.when === "today" || search.when === "week" || search.when === "weekend"
      ? search.when
      : "any";
  const viewMode: ViewMode = search.view === "map" ? "map" : "list";
  const density: Density = search.density === "grid" ? "grid" : "list";

  const setQ = (v: string) => updateSearch({ q: v });
  const setSport = (v: string) => updateSearch({ sport: v });
  const setSkill = (v: string) => updateSearch({ skill: v });
  const setMaxDistance = (v: number) => updateSearch({ dist: v });
  const setAgeMin = (v: number | "") => updateSearch({ ageMin: v === "" ? undefined : v });
  const setAgeMax = (v: number | "") => updateSearch({ ageMax: v === "" ? undefined : v });
  const setIncludeUnknownAge = (v: boolean) => updateSearch({ unknownAge: v });
  const setWhen = (v: "any" | "today" | "week" | "weekend") => updateSearch({ when: v });
  const switchView = (v: ViewMode) => updateSearch({ view: v });
  const switchDensity = (d: Density) => updateSearch({ density: d });

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [list, setList] = useState<AvailabilityWithAuthor[] | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [contactFor, setContactFor] = useState<AvailabilityWithAuthor | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // One-time migration: hydrate URL from previously-persisted localStorage
  // when the URL has no relevant params, then drop the old keys.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current) return;
    migratedRef.current = true;
    if (typeof window === "undefined") return;
    try {
      const hasSearch = window.location.search.length > 1;
      const rawF = window.localStorage.getItem("openrun.playersFilters.v1");
      const rawV = window.localStorage.getItem("openrun:players-view");
      const rawD = window.localStorage.getItem("openrun:players-density");
      if (!hasSearch && (rawF || rawV || rawD)) {
        const patch: Partial<typeof search> = {};
        if (rawF) {
          const f = JSON.parse(rawF) as Record<string, unknown>;
          if (typeof f.q === "string" && f.q) patch.q = f.q;
          if (typeof f.sport === "string" && f.sport) patch.sport = f.sport;
          if (typeof f.skill === "string" && f.skill) patch.skill = f.skill;
          if (typeof f.maxDistance === "number" && f.maxDistance > 0) patch.dist = f.maxDistance;
          if (typeof f.ageMin === "number") patch.ageMin = f.ageMin;
          if (typeof f.ageMax === "number") patch.ageMax = f.ageMax;
          if (typeof f.includeUnknownAge === "boolean") patch.unknownAge = f.includeUnknownAge;
        }
        if (rawV === "map" || rawV === "list") patch.view = rawV;
        if (rawD === "grid" || rawD === "list") patch.density = rawD;
        if (Object.keys(patch).length > 0) {
          navigate({ search: (prev: PlayersSearch) => ({ ...prev, ...patch }), replace: true });
        }
      }
      window.localStorage.removeItem("openrun.playersFilters.v1");
      window.localStorage.removeItem("openrun:players-view");
      window.localStorage.removeItem("openrun:players-density");
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setList(null);
    listOpenAvailabilities({ sport: sport || undefined })
      .then((rows) => {
        if (!cancelled) setList(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setList([]);
          toast.error(e.message || "Failed to load");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sport, reloadTick]);

  const ageActive = ageMin !== "" || ageMax !== "";
  const activeFilterCount =
    (sport ? 1 : 0) + (skill ? 1 : 0) + (maxDistance > 0 ? 1 : 0) + (ageActive ? 1 : 0);

  const filtered = useMemo(() => {
    if (!list) return null;
    const needle = q.trim().toLowerCase();
    let minA = ageMin === "" ? null : Number(ageMin);
    let maxA = ageMax === "" ? null : Number(ageMax);
    // Swap if reversed so the filter still behaves sensibly
    if (minA !== null && maxA !== null && minA > maxA) {
      const tmp = minA;
      minA = maxA;
      maxA = tmp;
    }
    const now = new Date();
    const todayISO = now.toISOString().slice(0, 10);
    const weekEnd = new Date(now.getTime() + 7 * 86400_000).toISOString().slice(0, 10);
    const dow = now.getDay(); // 0=Sun … 6=Sat
    const daysUntilSat = (6 - dow + 7) % 7;
    const satISO = new Date(now.getTime() + daysUntilSat * 86400_000).toISOString().slice(0, 10);
    const sunISO = new Date(now.getTime() + (daysUntilSat + 1) * 86400_000).toISOString().slice(0, 10);
    const overlaps = (start: string | null, end: string | null, from: string, to: string) => {
      const s = start ?? from;
      const e = end ?? to;
      return s <= to && e >= from;
    };
    const hasWeekendDay = (days: string[]) =>
      days.some((d) => /sat|sun/i.test(d));
    return list.filter((a) => {
      if (sport && !a.sports.some((s) => s.toLowerCase() === sport.toLowerCase())) return false;
      if (skill && a.skill_level !== skill) return false;
      if (maxDistance > 0 && kmToMi(a.travel_radius_km) > maxDistance) return false;
      if (when !== "any") {
        if (when === "today") {
          if (!overlaps(a.starts_on, a.ends_on, todayISO, todayISO)) return false;
        } else if (when === "week") {
          if (!overlaps(a.starts_on, a.ends_on, todayISO, weekEnd)) return false;
        } else if (when === "weekend") {
          const dateHit = overlaps(a.starts_on, a.ends_on, satISO, sunISO);
          const recurHit = hasWeekendDay(a.recurring_days ?? []);
          if (!dateHit && !recurHit) return false;
        }
      }
      if (minA !== null || maxA !== null) {
        const age = ageFromBirthday(a.author_birthday);
        if (age === null) {
          // No birthday on file — include only when the user has opted in.
          if (!includeUnknownAge) return false;
        } else {
          if (minA !== null && age < minA) return false;
          if (maxA !== null && age > maxA) return false;
        }
      }
      if (needle) {
        const hay = (
          a.author_name +
          " " +
          (a.city ?? "") +
          " " +
          (a.note ?? "") +
          " " +
          a.sports.join(" ")
        ).toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [list, q, sport, skill, maxDistance, ageMin, ageMax, includeUnknownAge, when]);

  function ageFromBirthday(iso: string | null): number | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age;
  }



  return (
    <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 pt-6">
      <CommunityTabs />



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
        <h1 className="font-display text-3xl font-bold leading-tight">Players ready to run.</h1>
        <p className="text-muted-foreground text-sm inline-flex items-center gap-1">
          {profile?.city ? (
            <>
              <MapPin className="h-3.5 w-3.5 text-lime" /> Nearest to {profile.city} ·{" "}
              {filtered?.length ?? 0} players
            </>
          ) : (
            <>
              {filtered?.length ?? 0} players ·{" "}
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
            placeholder="Search name, city, sport"
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
          aria-label="Filters"
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-lime text-[10px] font-bold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </button>
        <button
          onClick={() =>
            user ? setPostOpen(true) : toast.error("Sign in to post your availability.")
          }
          className="grid h-11 w-11 place-items-center rounded-full bg-lime-gradient text-primary-foreground glow-lime"
          aria-label="Post availability"
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>

      {/* Sport filter chips */}
      <div className="mb-3">
        <SportChips selected={sport || null} onSelect={(s) => setSport(s ?? "")} />
      </div>

      {/* Availability filter chips */}
      <div className="-mx-4 overflow-x-auto px-4 mb-4">
        <div className="flex gap-2 pb-1">
          {([
            { id: "any", label: "Anytime" },
            { id: "today", label: "Today" },
            { id: "week", label: "This week" },
            { id: "weekend", label: "Weekend" },
          ] as const).map((w) => {
            const active = when === w.id;
            return (
              <button
                key={w.id}
                onClick={() => setWhen(w.id)}
                className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "border-lime bg-lime text-primary-foreground"
                    : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {w.label}
              </button>
            );
          })}
        </div>
      </div>


      {viewMode === "map" ? (
        <PlayersMapView players={filtered ?? []} />
      ) : filtered === null ? (
        <LoadingRows />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={list && list.length > 0 ? "No matches" : "No one's posted yet"}
          body={
            list && list.length > 0
              ? "Try a different search or sport."
              : "Be the first — share when you're free and where you'll travel."
          }
          cta={
            user ? (
              <Button
                onClick={() => setPostOpen(true)}
                className="rounded-full bg-lime-gradient text-primary-foreground"
              >
                Post availability
              </Button>
            ) : (
              <Link
                to="/auth"
                className="inline-flex rounded-full bg-lime-gradient px-5 py-2.5 text-sm font-bold text-primary-foreground"
              >
                Sign in
              </Link>
            )
          }
        />
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
              {filtered.length} player{filtered.length === 1 ? "" : "s"} available
            </h2>
          </div>
          <ul
            className={
              density === "grid"
                ? "grid grid-cols-1 sm:grid-cols-2 gap-3 pb-6"
                : "space-y-3 pb-6"
            }
          >
            {filtered.map((a) => (
              <AvailabilityCard
                key={a.id}
                a={a}
                isMine={user?.id === a.user_id}
                hasHostedGames={myUpcomingHosted.length > 0}
                onContact={() =>
                  user ? setContactFor(a) : toast.error("Sign in to contact this player.")
                }
                onChanged={() => setReloadTick((t) => t + 1)}
              />
            ))}
          </ul>
        </>
      )}


      {postOpen && (
        <PostAvailabilityDialog
          onClose={() => setPostOpen(false)}
          onPosted={() => {
            setPostOpen(false);
            setReloadTick((t) => t + 1);
            toast.success("Availability posted");
          }}
        />
      )}
      {contactFor && (
        <ContactDialog
          availability={contactFor}
          hostedGames={myUpcomingHosted}
          onClose={() => setContactFor(null)}
        />
      )}

      <AnimatePresence>
        {filtersOpen && (
          <PlayersFilterSheet
            sport={sport}
            setSport={setSport}
            skill={skill}
            setSkill={setSkill}
            maxDistance={maxDistance}
            setMaxDistance={setMaxDistance}
            ageMin={ageMin}
            setAgeMin={setAgeMin}
            ageMax={ageMax}
            setAgeMax={setAgeMax}
            includeUnknownAge={includeUnknownAge}
            setIncludeUnknownAge={setIncludeUnknownAge}
            onClose={() => setFiltersOpen(false)}
            onReset={() => {
              setSport("");
              setSkill("");
              setMaxDistance(0);
              setAgeMin("");
              setAgeMax("");
              setIncludeUnknownAge(true);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function PlayersFilterSheet({
  sport,
  setSport,
  skill,
  setSkill,
  maxDistance,
  setMaxDistance,
  ageMin,
  setAgeMin,
  ageMax,
  setAgeMax,
  includeUnknownAge,
  setIncludeUnknownAge,
  onClose,
  onReset,
}: {
  sport: string;
  setSport: (v: string) => void;
  skill: string;
  setSkill: (v: string) => void;
  maxDistance: number;
  setMaxDistance: (v: number) => void;
  ageMin: number | "";
  setAgeMin: (v: number | "") => void;
  ageMax: number | "";
  setAgeMax: (v: number | "") => void;
  includeUnknownAge: boolean;
  setIncludeUnknownAge: (v: boolean) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const SKILLS = ["All Levels", "Beginner", "Intermediate", "Advanced"];
  const DISTANCES = [0, 5, 10, 25, 50, 100];
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
          <h2 className="font-display text-lg font-bold">Filter players</h2>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-border"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
          Sport (Players)
        </div>
        <div className="flex flex-wrap gap-2 mb-5">
          <Chip active={!sport} onClick={() => setSport("")}>
            All sports
          </Chip>
          {SPORTS.map((s) => (
            <Chip key={s.name} active={sport === s.name} onClick={() => setSport(s.name)}>
              <span className="mr-1">{s.emoji}</span>
              {s.name}
            </Chip>
          ))}
        </div>

        <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
          Skill level
        </div>
        <div className="flex flex-wrap gap-2 mb-5">
          <Chip active={!skill} onClick={() => setSkill("")}>
            Any
          </Chip>
          {SKILLS.map((s) => (
            <Chip key={s} active={skill === s} onClick={() => setSkill(s)}>
              {s}
            </Chip>
          ))}
        </div>

        <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
          Max travel distance
        </div>
        <div className="flex flex-wrap gap-2 mb-5">
          {DISTANCES.map((d) => (
            <Chip key={d} active={maxDistance === d} onClick={() => setMaxDistance(d)}>
              {d === 0 ? "Any" : `≤ ${d} mi`}
            </Chip>
          ))}
        </div>

        <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
          Age range
        </div>
        <div className="flex items-center gap-2 mb-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={120}
            value={ageMin}
            onChange={(e) =>
              setAgeMin(
                e.target.value === "" ? "" : Math.max(1, Math.min(120, Number(e.target.value))),
              )
            }
            placeholder="Min"
            className="flex-1 rounded-full border border-border bg-surface px-4 py-2 text-sm outline-none"
            aria-label="Minimum age"
          />
          <span className="text-muted-foreground text-sm">–</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={120}
            value={ageMax}
            onChange={(e) =>
              setAgeMax(
                e.target.value === "" ? "" : Math.max(1, Math.min(120, Number(e.target.value))),
              )
            }
            placeholder="Max"
            className="flex-1 rounded-full border border-border bg-surface px-4 py-2 text-sm outline-none"
            aria-label="Maximum age"
          />
        </div>
        <div className="flex flex-wrap gap-2 mb-5">
          <Chip
            active={ageMin === "" && ageMax === ""}
            onClick={() => {
              setAgeMin("");
              setAgeMax("");
            }}
          >
            Any age
          </Chip>
          <Chip
            active={ageMin === 13 && ageMax === 17}
            onClick={() => {
              setAgeMin(13);
              setAgeMax(17);
            }}
          >
            13–17
          </Chip>
          <Chip
            active={ageMin === 18 && ageMax === 24}
            onClick={() => {
              setAgeMin(18);
              setAgeMax(24);
            }}
          >
            18–24
          </Chip>
          <Chip
            active={ageMin === 25 && ageMax === 34}
            onClick={() => {
              setAgeMin(25);
              setAgeMax(34);
            }}
          >
            25–34
          </Chip>
          <Chip
            active={ageMin === 35 && ageMax === 49}
            onClick={() => {
              setAgeMin(35);
              setAgeMax(49);
            }}
          >
            35–49
          </Chip>
          <Chip
            active={ageMin === 50 && ageMax === ""}
            onClick={() => {
              setAgeMin(50);
              setAgeMax("");
            }}
          >
            50+
          </Chip>
        </div>
        <label className="flex items-center gap-2 mb-5 -mt-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            className="h-4 w-4 accent-lime"
            checked={includeUnknownAge}
            disabled={ageMin === "" && ageMax === ""}
            onChange={(e) => setIncludeUnknownAge(e.target.checked)}
          />
          <span>Include players who haven't shared a birthday</span>
        </label>

        <div className="flex gap-2">
          <button
            onClick={onReset}
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

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${active ? "border-lime bg-lime/15 text-foreground" : "border-border bg-surface text-muted-foreground"}`}
    >
      {children}
    </button>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-2xl border border-border bg-surface/40"
        />
      ))}
    </div>
  );
}

function EmptyState({ title, body, cta }: { title: string; body: string; cta?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center">
      <Inbox className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground mt-1 mb-4">{body}</p>
      {cta}
    </div>
  );
}

function AvailabilityCard({
  a,
  isMine,
  hasHostedGames,
  onContact,
  onChanged,
}: {
  a: AvailabilityWithAuthor;
  isMine: boolean;
  hasHostedGames: boolean;
  onContact: () => void;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const when = formatWindow(a);

  const handleMessage = async () => {
    try {
      const id = await getOrCreateDirectConversation(a.user_id);
      navigate({ to: "/messages/$conversationId", params: { conversationId: id } });
    } catch (e: any) {
      toast.error(e.message || "Couldn't open chat");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Remove this availability post?")) return;
    try {
      await deleteAvailability(a.id);
      toast.success("Removed");
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <li className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <Link
          to="/players/$userId"
          params={{ userId: a.user_id }}
          aria-label={`View ${a.author_name}'s profile`}
          className="shrink-0"
        >
          <UserAvatar
            avatarUrl={a.author_avatar_url}
            initials={a.author_initials}
            name={a.author_name}
            size="lg"
            rounded="square"
          />
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <Link
              to="/players/$userId"
              params={{ userId: a.user_id }}
              className="font-semibold truncate hover:underline"
            >
              {a.author_name}
            </Link>
            <span className="shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
              {a.skill_level}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {a.sports.length === 0 ? (
              <span className="text-xs text-muted-foreground">Any sport</span>
            ) : (
              a.sports.map((s) => {
                const emoji = SPORTS.find((sp) => sp.name === s)?.emoji ?? "🎯";
                return (
                  <span
                    key={s}
                    className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold"
                  >
                    {emoji} {s}
                  </span>
                );
              })
            )}
          </div>
          {when && (
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" /> {when}
            </p>
          )}
          {(a.city || a.travel_radius_km) && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {a.city || "Anywhere"} · up to {kmToMi(a.travel_radius_km)} mi
            </p>
          )}
          {a.note && <p className="mt-2 text-sm leading-snug">{a.note}</p>}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        {isMine ? (
          <Button variant="outline" size="sm" className="rounded-full" onClick={handleDelete}>
            <X className="h-4 w-4 mr-1" /> Remove
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              onClick={handleMessage}
              className="rounded-full flex-1 bg-lime-gradient text-primary-foreground"
            >
              <MessageCircle className="h-4 w-4 mr-1" /> Message
            </Button>
            <Button size="sm" variant="outline" onClick={onContact} className="rounded-full flex-1">
              {hasHostedGames ? (
                <>
                  <Ticket className="h-4 w-4 mr-1" /> Send invite
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-1" /> Contact
                </>
              )}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function formatWindow(a: PlayerAvailability): string {
  const parts: string[] = [];
  if (a.starts_on || a.ends_on) {
    const s = a.starts_on ? fmtDate(a.starts_on) : "";
    const e = a.ends_on ? fmtDate(a.ends_on) : "";
    if (s && e) parts.push(s === e ? s : `${s} – ${e}`);
    else parts.push(s || e);
  }
  if (a.recurring_days.length) parts.push(a.recurring_days.join(" · "));
  return parts.join(" · ");
}

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function PostAvailabilityDialog({
  onClose,
  onPosted,
}: {
  onClose: () => void;
  onPosted: () => void;
}) {
  const [sports, setSports] = useState<string[]>([]);
  const [skill, setSkill] = useState<string>("All Levels");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [city, setCity] = useState("");
  const [radius, setRadius] = useState(25);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const toggle = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const save = async () => {
    if (sports.length === 0 && !note.trim()) {
      toast.error("Pick at least one sport or add a note.");
      return;
    }
    setSaving(true);
    try {
      await createAvailability({
        sports,
        skill_level: skill,
        // datetime-local gives "YYYY-MM-DDTHH:mm"; DB columns are DATE → store date portion only.
        starts_on: starts ? starts.slice(0, 10) : null,
        ends_on: ends ? ends.slice(0, 10) : null,
        recurring_days: days,
        city,
        travel_radius_km: miToKm(radius),
        note,
      });
      onPosted();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Post availability</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Sports</Label>
            <div className="flex flex-wrap gap-2">
              {SPORTS.map((s) => (
                <Chip
                  key={s.name}
                  active={sports.includes(s.name)}
                  onClick={() => setSports((arr) => toggle(arr, s.name))}
                >
                  <span className="mr-1">{s.emoji}</span>
                  {s.name}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <Label className="mb-2 block">Skill level</Label>
            <div className="flex flex-wrap gap-2">
              {SKILLS.map((s) => (
                <Chip key={s} active={skill === s} onClick={() => setSkill(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="starts">From</Label>
              <input
                id="starts"
                type="datetime-local"
                value={starts}
                onChange={(e) => setStarts(e.target.value)}
                className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime [color-scheme:dark]"
              />
            </div>
            <div>
              <Label htmlFor="ends">Until</Label>
              <input
                id="ends"
                type="datetime-local"
                value={ends}
                onChange={(e) => setEnds(e.target.value)}
                className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime [color-scheme:dark]"
              />
            </div>
          </div>
          <div>
            <Label className="mb-2 block">Recurring days (optional)</Label>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <Chip
                  key={d}
                  active={days.includes(d)}
                  onClick={() => setDays((arr) => toggle(arr, d))}
                >
                  {d}
                </Chip>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <div>
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Austin"
              />
            </div>
            <div>
              <Label htmlFor="radius">Radius (mi)</Label>
              <Input
                id="radius"
                type="number"
                min={1}
                max={500}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value) || 0)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="note">Short note</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Positions, goals, what you're looking for…"
            />
            <p className="mt-1 text-[10px] text-muted-foreground text-right">{note.length}/500</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-lime-gradient text-primary-foreground"
          >
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog({
  availability,
  hostedGames,
  onClose,
}: {
  availability: AvailabilityWithAuthor;
  hostedGames: Game[];
  onClose: () => void;
}) {
  const isInvite = hostedGames.length > 0;
  const [gameId, setGameId] = useState<string>(hostedGames[0]?.id ?? "");
  const selected = hostedGames.find((g) => g.id === gameId);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [existingStatus, setExistingStatus] = useState<
    "none" | "pending" | "accepted" | "declined" | "withdrawn"
  >("none");
  const isPending = existingStatus === "pending";

  const formattedDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const send = async () => {
    setSaving(true);
    try {
      let body = msg.trim();
      const invite =
        isInvite && selected
          ? {
              gameId: selected.id,
              title: selected.title,
              startsAt: selected.date,
              sport: selected.sport,
              location: selected.location,
            }
          : null;
      if (invite) {
        const header = `You're invited to ${selected!.title} — ${selected!.sport} on ${formattedDate(selected!.date)} at ${selected!.location}.`;
        body = body ? `${header}\n\n${body}` : header;
      }
      await createContactRequest(availability.id, availability.user_id, body, invite);
      toast.success(isInvite ? "Invite sent" : "Contact request sent");
      onClose();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("duplicate") || (e as { code?: string })?.code === "23505") {
        toast.error(
          isInvite
            ? "You already have a pending invite to this player for this game."
            : "You already have a pending request to this player.",
        );
        setRefreshKey((k) => k + 1);
      } else toast.error(msg || "Couldn't send request");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isInvite
              ? `Invite ${availability.author_name}`
              : `Contact ${availability.author_name}`}
          </DialogTitle>
        </DialogHeader>

        <RequestStatusPanel
          availabilityId={availability.id}
          gameId={isInvite ? (selected?.id ?? null) : null}
          refreshKey={refreshKey}
          onLoaded={(s: ExistingRequestSummary) => setExistingStatus(s.status)}
          onCancelled={() => setExistingStatus("none")}
        />



        {isInvite && (
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              {hostedGames.length > 1 ? "Pick an event" : "Event"}
            </Label>
            {hostedGames.length === 1 ? (
              <div className="rounded-2xl border border-border bg-surface p-3">
                <p className="font-semibold text-sm truncate">{hostedGames[0].title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {hostedGames[0].sport} · {formattedDate(hostedGames[0].date)}
                </p>
                <p className="text-xs text-muted-foreground truncate">{hostedGames[0].location}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {hostedGames.map((g) => {
                  const active = g.id === gameId;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGameId(g.id)}
                      className={`w-full text-left rounded-2xl border p-3 transition ${active ? "border-lime bg-lime/10" : "border-border bg-surface"}`}
                    >
                      <p className="font-semibold text-sm truncate">{g.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {g.sport} · {formattedDate(g.date)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{g.location}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          {isInvite
            ? `Add a short note. ${availability.author_name} can accept or decline.`
            : `Send a short message introducing your team or session. ${availability.author_name} can accept or decline.`}
        </p>
        <Textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={4}
          maxLength={500}
          placeholder={
            isInvite
              ? "We'd love to have you — let me know if you can make it!"
              : "Hey! We're a Tuesday-night 7v7 squad short a midfielder…"
          }
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={send}
            disabled={saving || isPending || (isInvite && !selected)}
            className="bg-lime-gradient text-primary-foreground"
          >
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isPending
              ? isInvite
                ? "Invite pending"
                : "Request pending"
              : isInvite
                ? "Send invite"
                : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

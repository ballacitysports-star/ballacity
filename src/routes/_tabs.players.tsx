import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useEffect, useMemo, useRef, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import {
  X,
  Plus,
  MessageCircle,
  Send,
  Calendar,
  MapPin,
  Bell,
  Inbox,
  Loader2,
  Ticket,
  Share2,
  UserRound,
} from "lucide-react";

import { ViewDensityToggle, type ViewMode, type Density } from "@/components/ViewDensityToggle";
import { PlayersMapView } from "@/components/PlayersMapView";
import { NearbyPlayersPanel } from "@/components/NearbyPlayersPanel";
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
  getAvailabilityById,
  listOpenAvailabilities,
  updateAvailability,
  type PlayerAvailability,
  type ExistingRequestSummary,
} from "@/lib/availability";
import { MineView } from "@/components/players/MineView";
import { useAvailabilityGate, availabilityGateMessage } from "@/lib/availability-gate";
import { AvailabilityRequiredNotice } from "@/components/availability/AvailabilityRequiredNotice";
import { AvailabilityDetailDialog } from "@/components/players/AvailabilityDetailDialog";
import { shareAvailability } from "@/components/players/share-availability";
import { ExpandableAboutSection } from "@/components/ExpandableAboutSection";
import { ProfileLinksList } from "@/components/ProfileLinks";
import type { ProfileLink } from "@/lib/user-prefs-store";

import { AvailabilitySchedulePicker } from "@/components/availability/AvailabilitySchedulePicker";
import { useMyBusyBlocks } from "@/lib/availability-conflicts";
import {
  parseTimeSlots,
  summarizeSlots,
  nextOccurrence,
  slotsHitRange,
  fmtShortDate,
  fmt12,
  formatAvailabilityWindow,
  type TimeSlot,
} from "@/lib/availability-timeslots";
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
import { kmToMi, miToKm, distancePresets, MAX_DISTANCE_MI } from "@/lib/distance";
import { useMyProfile } from "@/lib/user-prefs-store";
import { FilterBar } from "@/components/FilterBar";
import { FilterSection } from "@/components/FilterSheet";
import { usePersistedSearch } from "@/hooks/use-persisted-search";
import { Distance } from "@/components/Distance";
import { useDistanceUnit } from "@/lib/user-prefs-store";
import {
  formatSportLevel,
  parseSportLevels,
  playerLevelsForSports,
  resolvePlayerLevel,
  sanitizeSkillForSport,
  scaleForSport,
} from "@/lib/sport-levels";
import { TierChips } from "@/components/sports/TierChips";
import { SportSkillLevels } from "@/components/filters/SportSkillLevels";
import { hideFinishedGames } from "@/lib/game-time";
import {
  countSkillSelections,
  matchesSportSkillFilter,
  parseSportList,
  parseSportSkillMap,
  sanitizeSportSkillMap,
  serializeSportList,
  serializeSportSkillMap,
  toggleSport,
  type SportSkillMap,
} from "@/lib/sport-filter";
import { markSportChoice, useProfileSportDefault, useDefaultSports } from "@/lib/default-sports";

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
  // "browse" (everyone's availability) | "mine" (your posts + requests).
  tab: fallback(z.string(), "browse").default("browse"),
  // Deep link to one availability post — opens it in a focused dialog.
  post: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_tabs/players")({
  head: () =>
    pageHead({
      path: "/players",
      title: "Players near you — OpenRun",
      description:
        "Find available players and teammates nearby by sport, skill tier, and availability.",
      noindex: true,
    }),
  validateSearch: zodValidator(playersSearchSchema),
  component: PlayersPage,
});

// One-time upgrade of the pre-snapshot localStorage keys into the single
// "openrun:players-search" snapshot that usePersistedSearch reads. Runs at
// most once per page load and before the first restore.
let legacyMigrationDone = false;
function migrateLegacyPlayersFilters() {
  if (legacyMigrationDone) return;
  legacyMigrationDone = true;
  if (typeof window === "undefined") return;
  try {
    const rawF = window.localStorage.getItem("openrun.playersFilters.v1");
    const rawV = window.localStorage.getItem("openrun:players-view");
    const rawD = window.localStorage.getItem("openrun:players-density");
    if (!rawF && !rawV && !rawD) return;
    const patch: Record<string, unknown> = {};
    if (rawF) {
      const f = JSON.parse(rawF) as Record<string, unknown>;
      if (typeof f.q === "string" && f.q) patch.q = f.q;
      if (typeof f.sport === "string" && f.sport) patch.sport = f.sport;
      if (typeof f.skill === "string" && f.skill) {
        // A tier saved under an older sport scale must not survive the restore.
        patch.skill = sanitizeSkillForSport(typeof f.sport === "string" ? f.sport : "", f.skill);
      }
      if (typeof f.maxDistance === "number" && f.maxDistance > 0) patch.dist = f.maxDistance;
      if (typeof f.ageMin === "number") patch.ageMin = f.ageMin;
      if (typeof f.ageMax === "number") patch.ageMax = f.ageMax;
      if (typeof f.includeUnknownAge === "boolean") patch.unknownAge = f.includeUnknownAge;
    }
    if (rawV === "map" || rawV === "list") patch.view = rawV;
    if (rawD === "grid" || rawD === "list") patch.density = rawD;
    window.localStorage.removeItem("openrun.playersFilters.v1");
    window.localStorage.removeItem("openrun:players-view");
    window.localStorage.removeItem("openrun:players-density");
    if (Object.keys(patch).length === 0) return;
    // Never clobber an existing new-format snapshot.
    if (window.localStorage.getItem("openrun:players-search")) return;
    window.localStorage.setItem("openrun:players-search", JSON.stringify({ v: 2, s: patch }));
  } catch {
    // ignore
  }
}

function PlayersPage() {
  const { user } = useAuth();
  const profile = useMyProfile(user);
  const hostedGames = useHostedGames();

  const myUpcomingHosted = useMemo(() => {
    if (!user) return [];
    const now = Date.now();
    return hideFinishedGames(
      hostedGames.filter((g) => g.hostUserId === user.id),
      now,
    )
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [hostedGames, user?.id]);
  const search = Route.useSearch();
  type PlayersSearch = typeof search;
  const navigate = useNavigate({ from: "/players" });
  // Most filter tweaks replace the current entry (they're incremental), but
  // sport/skill are the two the user expects to step through with the browser
  // back/forward buttons, so those push a real history entry.
  const updateSearch = (patch: Partial<PlayersSearch>, opts?: { push?: boolean }) =>
    navigate({
      search: (prev: PlayersSearch) => ({ ...prev, ...patch }),
      replace: !opts?.push,
    });
  // Fold any legacy localStorage keys into the new snapshot BEFORE the
  // persistence hook restores, so the migration can't be overwritten.
  migrateLegacyPlayersFilters();
  // `post` and `tab` are navigation state, not view preferences — keep them out
  // of the saved snapshot so a shared post link never sticks around.
  const persistedSearch = useMemo(() => {
    const { post: _post, tab: _tab, ...rest } = search;
    return rest;
  }, [search]);
  const { hydrated } = usePersistedSearch("openrun:players-search", persistedSearch, "/players", {
    q: "",
    sport: "",
    skill: "",
    dist: 0,
    ageMin: undefined,
    ageMax: undefined,
    unknownAge: true,
    when: "any",
    view: "list",
    density: "list",
  });

  const q = search.q;
  // `sport` is a comma-separated list; `skill` a per-sport tier map
  // ("Baseball:College / Adult Competitive|Football:7v7 Travel / Showcase").
  const sports = useMemo(() => parseSportList(search.sport), [search.sport]);
  const sportsKey = sports.join(",");
  const skills = useMemo(() => parseSportSkillMap(search.skill, sports), [search.skill, sportsKey]);
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
  const setSports = (next: string[]) => {
    // Tiers are sport-specific — drop selections the new sport set doesn't have.
    const nextSkills = sanitizeSportSkillMap(skills, next);
    updateSearch(
      {
        sport: serializeSportList(next),
        skill: serializeSportSkillMap(nextSkills, next),
      },
      { push: true },
    );
  };
  const toggleSportFilter = (name: string | null) => {
    markSportChoice("players");
    setSports(toggleSport(sports, name));
  };
  // Default to the viewer's profile sports until they pick for themselves.
  useProfileSportDefault("players", {
    ready: hydrated,
    current: sports,
    apply: (next) => updateSearch({ sport: serializeSportList(next) }),
  });

  const setSkills = (next: SportSkillMap) => {
    const safe = sanitizeSportSkillMap(next, sports);
    updateSearch({ skill: serializeSportSkillMap(safe, sports) }, { push: true });
  };

  const setMaxDistance = (v: number) => updateSearch({ dist: v });
  const setAgeMin = (v: number | "") => updateSearch({ ageMin: v === "" ? undefined : v });
  const setAgeMax = (v: number | "") => updateSearch({ ageMax: v === "" ? undefined : v });
  const setIncludeUnknownAge = (v: boolean) => updateSearch({ unknownAge: v });
  const setWhen = (v: "any" | "today" | "week" | "weekend") => updateSearch({ when: v });
  const switchView = (v: ViewMode) => updateSearch({ view: v });
  const switchDensity = (d: Density) => updateSearch({ density: d });

  const [list, setList] = useState<AvailabilityWithAuthor[] | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<PlayerAvailability | null>(null);
  const [contactFor, setContactFor] = useState<AvailabilityWithAuthor | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // Availability lives on the player profile — gate posting on having one.
  const availGate = useAvailabilityGate();
  const [gateOpen, setGateOpen] = useState(false);
  const openPostFlow = () => {
    if (availGate.canPost) setPostOpen(true);
    else setGateOpen(true);
  };

  const tab: "browse" | "mine" = search.tab === "mine" ? "mine" : "browse";
  const setTab = (v: "browse" | "mine") => updateSearch({ tab: v }, { push: true });

  // Focused post (`/players?post=<id>`) — shared links open the dialog even
  // when the post isn't in the current filtered list.
  const focusedId = search.post;
  const [focused, setFocused] = useState<AvailabilityWithAuthor | null>(null);
  const openPost = (id: string) => updateSearch({ post: id }, { push: true });
  const closePost = () => updateSearch({ post: "" }, { push: true });

  useEffect(() => {
    if (!focusedId) {
      setFocused(null);
      return;
    }
    let cancelled = false;
    const known = list?.find((a) => a.id === focusedId) ?? null;
    if (known) {
      setFocused(known);
      return;
    }
    getAvailabilityById(focusedId)
      .then((row) => {
        if (cancelled) return;
        if (row) setFocused(row);
        else {
          toast.error("That availability post is no longer available.");
          updateSearch({ post: "" });
        }
      })
      .catch((e) => {
        if (!cancelled) toast.error(e.message || "Couldn't load that post");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, list]);

  // Legacy localStorage keys are folded into the new snapshot above, before
  // the persistence hook runs (see migrateLegacyPlayersFilters).

  // Any skill/sport pair can also arrive from a pasted URL, a browser refresh,
  // localStorage restore, or a saved view. Scrub incompatible tiers out of the
  // URL itself so the chips, the filter count, and the results always agree.
  useEffect(() => {
    const safe = serializeSportSkillMap(sanitizeSportSkillMap(skills, sports), sports);
    if (safe !== search.skill) updateSearch({ skill: safe });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sportsKey, search.skill]);

  useEffect(() => {
    // Hold off until the saved view is restored, so the first fetch already
    // uses the user's sports rather than the empty defaults.
    if (!hydrated) return;
    let cancelled = false;
    setList(null);
    listOpenAvailabilities({ sports })
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
  }, [sportsKey, reloadTick, hydrated]);

  const ageActive = ageMin !== "" || ageMax !== "";
  const activeFilterCount =
    (sports.length ? 1 : 0) +
    countSkillSelections(skills) +
    (maxDistance > 0 ? 1 : 0) +
    (ageActive ? 1 : 0);

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
    const sunISO = new Date(now.getTime() + (daysUntilSat + 1) * 86400_000)
      .toISOString()
      .slice(0, 10);
    const overlaps = (start: string | null, end: string | null, from: string, to: string) => {
      const s = start ?? from;
      const e = end ?? to;
      return s <= to && e >= from;
    };
    // Prefer explicit time slots when present; fall back to the legacy range.
    const hits = (a: AvailabilityWithAuthor, from: string, to: string) => {
      const slots = parseTimeSlots(a.time_slots ?? []);
      if (slots.length > 0) return slotsHitRange(slots, from, to);
      return overlaps(a.starts_on, a.ends_on, from, to);
    };
    const hasWeekendDay = (days: string[]) => days.some((d) => /sat|sun/i.test(d));
    return list.filter((a) => {
      if (!matchesSportSkillFilter(a.author_sport_levels, a.sports, a.skill_level, sports, skills))
        return false;

      if (maxDistance > 0 && kmToMi(a.travel_radius_km) > maxDistance) return false;
      if (when !== "any") {
        if (when === "today") {
          if (!hits(a, todayISO, todayISO)) return false;
        } else if (when === "week") {
          if (!hits(a, todayISO, weekEnd)) return false;
        } else if (when === "weekend") {
          const dateHit = hits(a, satISO, sunISO);
          const recurHit = hasWeekendDay(a.recurring_days ?? []);
          if (!dateHit && !recurHit) return false;
        }
      }
      if (minA !== null || maxA !== null) {
        const age = a.author_age ?? null;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, q, sportsKey, search.skill, maxDistance, ageMin, ageMax, includeUnknownAge, when]);

  return (
    <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 pt-6">
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

      {/* Browse everyone's availability, or manage your own posts/requests. */}
      <div className="mb-4 flex gap-2">
        {(
          [
            { id: "browse", label: "Browse" },
            { id: "mine", label: "Mine" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`rounded-full border px-4 py-1.5 text-xs font-bold transition-colors ${
              tab === t.id
                ? "border-lime bg-lime text-primary-foreground"
                : "border-border bg-surface text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "mine" ? (
        <div className="space-y-3 pb-6">
          {!availGate.loading && !availGate.canPost && (
            <AvailabilityRequiredNotice
              reason={availGate.reason}
              onSwitched={() => setPostOpen(true)}
            />
          )}
          <MineView
            user={user ? { id: user.id } : null}
            onEdit={(m) => setEditingPost(m)}
            refreshKey={reloadTick}
          />
        </div>
      ) : (
        <>
          <NearbyPlayersPanel
            players={list}
            mySports={profile?.sports?.map((s) => s.name)}
            myCity={profile?.city}
            currentUserId={user?.id ?? null}
          />

          <ViewDensityToggle
            view={viewMode}
            onViewChange={switchView}
            density={density}
            onDensityChange={switchDensity}
          />

          <FilterBar
            q={q}
            onQChange={setQ}
            searchPlaceholder="Search name, city, sport"
            activeFilterCount={activeFilterCount}
            sheetTitle="Filter players"
            rightExtra={
              <button
                onClick={openPostFlow}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-lime-gradient text-primary-foreground glow-lime"
                aria-label="Post availability"
              >
                <Plus className="h-5 w-5" strokeWidth={2.5} />
              </button>
            }
            onReset={() => {
              markSportChoice("players");
              setSports([]);
              setMaxDistance(0);
              setAgeMin("");
              setAgeMax("");
              setIncludeUnknownAge(true);
            }}
            sheet={
              <PlayersFilterBody
                sports={sports}
                onToggleSport={toggleSportFilter}
                onClearSports={() => {
                  markSportChoice("players");
                  setSports([]);
                }}
                skills={skills}
                setSkills={setSkills}
                maxDistance={maxDistance}
                setMaxDistance={setMaxDistance}
                ageMin={ageMin}
                setAgeMin={setAgeMin}
                ageMax={ageMax}
                setAgeMax={setAgeMax}
                includeUnknownAge={includeUnknownAge}
                setIncludeUnknownAge={setIncludeUnknownAge}
              />
            }
          />

          {/* Sport filter chips */}
          <div className="mb-3">
            <SportChips multi selected={sports} onSelect={toggleSportFilter} />
          </div>

          {/* Availability filter chips */}
          <div className="-mx-4 overflow-x-auto px-4 mb-4">
            <div className="flex gap-2 pb-1">
              {(
                [
                  { id: "any", label: "Anytime" },
                  { id: "today", label: "Today" },
                  { id: "week", label: "This week" },
                  { id: "weekend", label: "Weekend" },
                ] as const
              ).map((w) => {
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
                    onClick={openPostFlow}
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
                    onOpen={() => openPost(a.id)}
                    onChanged={() => setReloadTick((t) => t + 1)}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <Dialog open={gateOpen} onOpenChange={(o) => !o && setGateOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Post availability</DialogTitle>
          </DialogHeader>
          <AvailabilityRequiredNotice
            reason={availGate.reason}
            onSwitched={() => {
              setGateOpen(false);
              setPostOpen(true);
            }}
          />
        </DialogContent>
      </Dialog>

      {(postOpen || editingPost) && (
        <PostAvailabilityDialog
          initial={editingPost}
          onClose={() => {
            setPostOpen(false);
            setEditingPost(null);
          }}
          onPosted={() => {
            const wasEdit = !!editingPost;
            setPostOpen(false);
            setEditingPost(null);
            setReloadTick((t) => t + 1);
            toast.success(wasEdit ? "Availability updated" : "Availability posted");
          }}
        />
      )}
      {focused && (
        <AvailabilityDetailDialog
          a={focused}
          isMine={user?.id === focused.user_id}
          canInvite={myUpcomingHosted.length > 0}
          onContact={() =>
            user ? setContactFor(focused) : toast.error("Sign in to contact this player.")
          }
          onEdit={() => {
            setEditingPost(focused);
            closePost();
          }}
          onClose={closePost}
        />
      )}
      {contactFor && (
        <ContactDialog
          availability={contactFor}
          hostedGames={myUpcomingHosted}
          onClose={() => setContactFor(null)}
        />
      )}
    </div>
  );
}

function PlayersFilterBody({
  sports,
  onToggleSport,
  onClearSports,
  skills,
  setSkills,
  maxDistance,
  setMaxDistance,
  ageMin,
  setAgeMin,
  ageMax,
  setAgeMax,
  includeUnknownAge,
  setIncludeUnknownAge,
}: {
  sports: string[];
  onToggleSport: (v: string | null) => void;
  onClearSports: () => void;
  skills: SportSkillMap;
  setSkills: (v: SportSkillMap) => void;
  maxDistance: number;
  setMaxDistance: (v: number) => void;
  ageMin: number | "";
  setAgeMin: (v: number | "") => void;
  ageMax: number | "";
  setAgeMax: (v: number | "") => void;
  includeUnknownAge: boolean;
  setIncludeUnknownAge: (v: boolean) => void;
}) {
  const unit = useDistanceUnit();
  // Round presets in the viewer's unit; the stored value stays in miles.
  const presets = distancePresets(unit).map((p) => ({
    ...p,
    mi: Math.round(p.mi * 100) / 100,
  }));
  return (
    <>
      <FilterSection label="Sports (Players)">
        <div className="flex flex-wrap gap-2">
          <Chip active={sports.length === 0} onClick={onClearSports}>
            All sports
          </Chip>
          {SPORTS.map((s) => (
            <Chip
              key={s.name}
              active={sports.includes(s.name)}
              onClick={() => onToggleSport(s.name)}
            >
              <span className="mr-1">{s.emoji}</span>
              {s.name}
            </Chip>
          ))}
        </div>
      </FilterSection>

      <FilterSection label="Skill level">
        <SportSkillLevels sports={sports} value={skills} onChange={setSkills} />
      </FilterSection>

      <FilterSection label="Max travel distance">
        <div className="flex flex-wrap gap-2">
          <Chip active={maxDistance === 0} onClick={() => setMaxDistance(0)}>
            Any
          </Chip>
          {presets.map(({ mi, label }) => (
            <Chip
              key={label}
              active={Math.abs(maxDistance - mi) < 0.01}
              onClick={() => setMaxDistance(mi)}
            >
              ≤ {label}
            </Chip>
          ))}
        </div>
      </FilterSection>

      <FilterSection label="Age range">
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
            className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm outline-none"
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
            className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm outline-none"
            aria-label="Maximum age"
          />
        </div>
        <div className="flex flex-wrap gap-2">
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
        <label className="flex items-center gap-2 mt-3 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            className="h-4 w-4 accent-lime"
            checked={includeUnknownAge}
            disabled={ageMin === "" && ageMax === ""}
            onChange={(e) => setIncludeUnknownAge(e.target.checked)}
          />
          <span>Include players who haven't shared a birthday</span>
        </label>
      </FilterSection>
    </>
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
  onOpen,
  onChanged,
}: {
  a: AvailabilityWithAuthor;
  isMine: boolean;
  hasHostedGames: boolean;
  onContact: () => void;
  onOpen: () => void;
  onChanged: () => void;
}) {
const navigate = useNavigate();
  const when = formatWindow(a);
  const authorLinks: ProfileLink[] = Array.isArray(a.author_links)
    ? (a.author_links as ProfileLink[])
    : [];

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
            {(() => {
              // Profile tier wins; only fall back to the post's own level when
              // the profile has none for any of the listed sports.
              const profileLevels = playerLevelsForSports(a.author_sport_levels, a.sports);
              if (profileLevels.length > 0) return null;
              const fallback = resolvePlayerLevel(null, null, a.skill_level);
              return fallback ? (
                <span className="shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
                  {formatSportLevel(fallback)}
                </span>
              ) : null;
            })()}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {a.sports.length === 0 ? (
              <span className="text-xs text-muted-foreground">Any sport</span>
            ) : (
              a.sports.map((s) => {
                const emoji = SPORTS.find((sp) => sp.name === s)?.emoji ?? "🎯";
                const level = parseSportLevels(a.author_sport_levels)[s] ?? null;
                const levelText = formatSportLevel(level);
                return (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold"
                  >
                    {emoji} {s}
                    {levelText && (
                      <span className="rounded-full bg-lime/15 px-1.5 text-[10px] font-bold text-lime">
                        {levelText}
                      </span>
                    )}
                  </span>
                );
              })
            )}
          </div>

          {when && (
            <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
              <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0" />{" "}
              <span className="min-w-0 flex-1 whitespace-normal break-words">{when}</span>
            </p>
          )}
          {(a.city || a.travel_radius_km) && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {a.city || "Anywhere"} · up to <Distance km={a.travel_radius_km} />
            </p>
          )}
          {a.note && <p className="mt-2 text-sm leading-snug">{a.note}</p>}
        </div>
      </div>

      {/* Key stats strip — the player-card summary from the old page. */}
      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-border bg-background/40 p-2 text-center">
        {[
          {
            label: "Level",
            value:
              formatSportLevel(
                resolvePlayerLevel(a.author_sport_levels, a.sports[0] ?? null, a.skill_level),
              ) || "—",
          },
          { label: "Sports", value: a.sports.length ? String(a.sports.length) : "Any" },
          { label: "Travels", value: <Distance km={a.travel_radius_km} /> },
        ].map((s) => (
          <div key={s.label}>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {s.label}
            </dt>
            <dd className="truncate text-xs font-semibold">{s.value}</dd>
          </div>
        ))}
</dl>

{/* About — the player's profile bio + key identity details + links. */}
      {(a.author_bio || a.author_city || a.travel_radius_km > 0 || authorLinks.length > 0) && (
        <div className="mt-3 rounded-2xl border border-border bg-background/40 p-3">
          {a.author_bio && (
            <section>
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                About
              </h2>
              <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap line-clamp-3">
                {a.author_bio}
              </p>
            </section>
          )}
          {(a.author_city || a.travel_radius_km > 0 || authorLinks.length > 0) && (
            <div className={a.author_bio ? "mt-2 border-t border-border/60 pt-2" : ""}>
              <ExpandableAboutSection
                label="Details"
                defaultOpen={!a.author_bio && authorLinks.length === 0}
              >
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {a.author_city && (
                    <li className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-lime" /> {a.author_city}
                    </li>
                  )}
                  {a.travel_radius_km > 0 && (
                    <li className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-lime" />
                      Travels up to <Distance km={a.travel_radius_km} />
                    </li>
                  )}
                </ul>
                {authorLinks.length > 0 && (
                  <div className="mt-2">
                    <ProfileLinksList links={authorLinks} />
                  </div>
                )}
              </ExpandableAboutSection>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        {isMine ? (
          <>
            <Button variant="outline" size="sm" className="rounded-full" onClick={onOpen}>
              Open
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => shareAvailability(a.id)}
            >
              <Share2 className="h-4 w-4 mr-1" /> Share
            </Button>
            <Button variant="outline" size="sm" className="rounded-full" onClick={handleDelete}>
              <X className="h-4 w-4 mr-1" /> Remove
            </Button>
          </>
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

      <div className="mt-2 flex items-center gap-3">
        <Link
          to="/players/$userId"
          params={{ userId: a.user_id }}
          className="inline-flex items-center gap-1 text-xs font-semibold text-lime"
        >
          <UserRound className="h-3.5 w-3.5" /> View full profile
        </Link>

        {!isMine && (
          <>
            <button onClick={onOpen} className="text-xs font-semibold text-muted-foreground">
              Open post
            </button>
            <button
              onClick={() => shareAvailability(a.id)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"
            >
              <Share2 className="h-3.5 w-3.5" /> Share
            </button>
          </>
        )}
      </div>
    </li>
  );
}

const formatWindow = (a: PlayerAvailability): string => formatAvailabilityWindow(a);

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function PostAvailabilityDialog({
  initial,
  onClose,
  onPosted,
}: {
  /** When set, the dialog edits this existing post instead of creating one. */
  initial?: PlayerAvailability | null;
  onClose: () => void;
  onPosted: () => void;
}) {
  const myProfile = useMyProfile();
  const gate = useAvailabilityGate();
  const isEdit = !!initial;
  const { sports: mySports } = useDefaultSports();
  // New posts start from the viewer's profile sports; edits keep their own.
  const [sports, setSports] = useState<string[]>(initial?.sports ?? []);
  const sportsTouchedRef = useRef(false);
  useEffect(() => {
    if (initial || sportsTouchedRef.current || !mySports.length) return;
    setSports((cur) => (cur.length ? cur : mySports));
  }, [initial, mySports]);
  // Per-sport tiers, mirroring the profile editor. Keyed by sport name.
  const [levels, setLevels] = useState<Record<string, string>>(() =>
    initial && initial.sports.length && initial.skill_level
      ? { [initial.sports[0]]: initial.skill_level }
      : {},
  );

  const [slots, setSlots] = useState<TimeSlot[]>(() =>
    initial ? parseTimeSlots(initial.time_slots ?? []) : [],
  );
  const { data: busy = [] } = useMyBusyBlocks();
  const [city, setCity] = useState(initial?.city ?? "");
  const unit = useDistanceUnit();
  const [radius, setRadius] = useState(() => {
    const km = initial?.travel_radius_km ?? 40.2336;
    return Math.round(unit === "km" ? km : kmToMi(km));
  }); // in the viewer's unit
  const [note, setNote] = useState(initial?.note ?? "");
  const [saving, setSaving] = useState(false);
  const toggle = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const save = async () => {
    // Belt-and-braces: a stale dialog or deep link can't bypass the gate.
    if (!gate.loading && !gate.canPost) {
      toast.error(availabilityGateMessage(gate.reason));
      return;
    }
    if (sports.length === 0 && !note.trim()) {
      toast.error("Pick at least one sport or add a note.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        sports,
        // The primary sport's tier is what the text column stores.
        skill_level: (sports.length ? levels[sports[0]] : "") || "All Levels",

        // datetime-local gives "YYYY-MM-DDTHH:mm"; DB columns are DATE → store date portion only.
        time_slots: slots,
        city,
        travel_radius_km: unit === "km" ? radius : miToKm(radius),
        note,
      };
      if (initial) await updateAvailability(initial.id, payload);
      else await createAvailability(payload);
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
          <DialogTitle>{isEdit ? "Edit availability" : "Post availability"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Sports</Label>
            <div className="flex flex-wrap gap-2">
              {SPORTS.map((s) => (
                <Chip
                  key={s.name}
                  active={sports.includes(s.name)}
                  onClick={() => {
                    sportsTouchedRef.current = true;
                    setSports((arr) => {
                      const next = toggle(arr, s.name);
                      // Prefill from the profile tier the first time a sport is added.
                      if (!arr.includes(s.name)) {
                        const mine = myProfile?.sports.find((x) => x.name === s.name)?.level?.tier;
                        if (mine) setLevels((l) => ({ ...l, [s.name]: mine }));
                      }
                      return next;
                    });
                  }}
                >
                  <span className="mr-1">{s.emoji}</span>
                  {s.name}
                </Chip>
              ))}
            </div>
          </div>
          {sports.length === 0 ? (
            <p className="text-xs text-muted-foreground">Pick a sport to set your level for it.</p>
          ) : (
            sports.map((name) => {
              const scale = scaleForSport(name as any);
              return (
                <div key={name}>
                  <div className="mb-2 flex items-baseline gap-2">
                    <Label className="block">{name} level</Label>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {scale.system}
                    </span>
                  </div>
                  <TierChips
                    scale={scale}
                    selected={levels[name] ? [levels[name]] : []}
                    ariaPrefix={name}
                    onToggle={(tier) =>
                      setLevels((l) => ({
                        ...l,
                        [name]: l[name] === tier ? "" : tier,
                      }))
                    }
                  />
                </div>
              );
            })
          )}
          <div>
            <Label className="mb-2 block">When are you free?</Label>
            <AvailabilitySchedulePicker value={slots} onChange={setSlots} busy={busy} />
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
              <Label htmlFor="radius">Radius ({unit})</Label>
              <Input
                id="radius"
                type="number"
                min={1}
                max={MAX_DISTANCE_MI}
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
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isEdit ? "Save" : "Post"}
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

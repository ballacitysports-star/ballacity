import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMessageOrGuardian } from "@/components/messages/useMessageOrGuardian";
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

import type { ViewMode, Density } from "@/components/ViewDensityToggle";
import { PlayersMapView } from "@/components/PlayersMapView";
import { NearbyPlayersPanel } from "@/components/NearbyPlayersPanel";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { SportChips } from "@/components/SportChips";
import { MyAvatar, UserAvatar } from "@/components/UserAvatar";
import { usePrefetchUserAvatars, useAvatarViewportPriority } from "@/lib/user-avatars";

import { useAuth } from "@/hooks/use-auth";
import { useUnreadNotificationCount } from "@/lib/notifications";
import { SPORTS } from "@/lib/sample-data";
import {
  type AvailabilityWithAuthor,
  createAvailability,
  createContactRequest,
  deleteAvailability,
  getAvailabilityById,
  listAvailabilityNear,
  listOpenAvailabilities,
  updateAvailability,
  type NearbyAvailabilityQuery,
  type PlayerAvailability,
  type ExistingRequestSummary,
} from "@/lib/availability";
import { useAvailabilityGate, availabilityGateMessage } from "@/lib/availability-gate";
import { QuickAvailabilitySheet } from "@/components/availability/QuickAvailabilitySheet";
import { AvailabilityRequiredNotice } from "@/components/availability/AvailabilityRequiredNotice";
import { PostAvailabilityDialog } from "@/components/availability/PostAvailabilityDialog";
import { AvailabilityDetailDialog } from "@/components/players/AvailabilityDetailDialog";
import { AvailabilityIntentBadges } from "@/components/players/AvailabilityIntentBadges";
import {
  AVAILABILITY_INTENTS,
  INTENT_BLURB,
  INTENT_LABEL,
  buildSkillFields,
  initialLevelsForPost,
  isAvailabilityIntent,
  parseIntents,
  postTiersForSport,
  type AvailabilityIntent,
} from "@/lib/availability-levels";
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
  formatAvailabilityWindowShort,
  type TimeSlot,
} from "@/lib/availability-timeslots";
import { RequestStatusPanel } from "@/components/RequestStatusPanel";
import { errorText, userErrorMessage } from "@/lib/user-error";
import {
  cancelGameInvite,
  findGameInvite,
  gameInviteErrorMessage,
  inviteToGame,
  type GameInvite,
} from "@/lib/game-invites";
import { useHostedGames } from "@/lib/hosted-games-store";
import type { Game } from "@/lib/sample-data";
import { useAuthSearchHere } from "@/lib/auth-return";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { kmToMi, miToKm, maxDistanceInUnit } from "@/lib/distance";
import { useMyProfile } from "@/lib/user-prefs-store";
import { FilterBar } from "@/components/FilterBar";
import { usePersistedSearch } from "@/hooks/use-persisted-search";
import { Distance } from "@/components/Distance";
import {
  formatSportLevel,
  levelTiers,
  parseSportLevels,
  resolvePlayerLevel,
  sanitizeSkillForSport,
  scaleForSport,
} from "@/lib/sport-levels";
import { TierChips } from "@/components/sports/TierChips";
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
import { basketballFirstPriority } from "@/lib/sport-hubs";
import { SortSummary } from "@/components/filters/SortSection";
import { haversineKm, MI_PER_KM, useUserLocation } from "@/lib/geo";
import { availabilityWindowFor } from "@/lib/availability-window";
import { useParentMode } from "@/hooks/use-parent-mode";
import { Shield } from "lucide-react";
import { InviteToTeamDialog, useMyRecruitingTeams } from "@/components/players/InviteToTeamDialog";
import { PreviewGate } from "@/components/public/PreviewGate";
import {
  PLAYER_SORTS,
  PlayersFilterBody,
  type PlayersSortBy,
} from "@/components/players/PlayersFilterBody";
import { PlayersMapHeader } from "@/components/players/PlayersMapHeader";

/** Find Players pages from the server search (it allows up to 50). */
const NEARBY_PAGE_SIZE = 30;
/** Radius when the distance filter is off, in miles: the quick post's default travel radius. */
const NEARBY_DEFAULT_RADIUS_MI = 25;

/** The sentence createAvailability throws itself when the session is gone (src/lib/availability.ts). */
const SIGN_IN_TO_POST = "Sign in to post availability.";

/**
 * A sentence of ours that createContactRequest threw (sign in first, you can't contact yourself, the explained
 * minor-messaging line): it throws those as plain Errors with no code, and rethrows the database's own refusals as the
 * PostgrestError itself. Undefined for anything else, which then goes through userErrorMessage (WP 4.0).
 */
function ownErrorSentence(e: unknown): string | undefined {
  return e instanceof Error && e.name === "Error" && !("code" in e) && e.message
    ? e.message
    : undefined;
}

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
  // "" | "pickup" | "guest" | "tryout" — what the player is available as.
  as: fallback(z.string(), "").default(""),
  sort: fallback(z.string(), "recent").default("recent"),
  view: fallback(z.string(), "list").default("list"),
  density: fallback(z.string(), "list").default("list"),
  // Legacy: "mine" was your posts and requests. It now lives on /availability, and beforeLoad redirects the old
  // `/players?tab=mine` links (Home, notifications) there.
  tab: fallback(z.string(), "browse").default("browse"),
  // Deep link to one availability post — opens it in a focused dialog.
  post: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_tabs/players")({
  head: () =>
    pageHead({
      path: "/players",
      title: "Find Local Sports Players & Athletes | BallaCity",
      description:
        "Find available players and teammates nearby by sport, skill tier, and availability.",
      noindex: true,
    }),
  validateSearch: zodValidator(playersSearchSchema),
  // WP 4.1: one screen for My availability & invitations.
  beforeLoad: ({ search }) => {
    if (search.tab === "mine") throw redirect({ to: "/availability", replace: true });
  },
  component: PlayersPageGate,
});

/** A signed-out visitor gets a blurred sample preview; the real page mounts only for a member. */
function PlayersPageGate() {
  return (
    <PreviewGate tab="players">
      <PlayersPage />
    </PreviewGate>
  );
}

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
  const authSearch = useAuthSearchHere();
  const { isParentMode } = useParentMode();
  const profile = useMyProfile(user);
  const hostedGames = useHostedGames();

  const myUpcomingHosted = useMemo(() => {
    if (!user) return [];
    const now = Date.now();
    return hideFinishedGames(
      hostedGames.filter((g) => g.hostUserId === user.id),
      now,
    ).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
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
    as: "",
    sort: "recent",

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
  const availableAs: AvailabilityIntent | "" = isAvailabilityIntent(search.as) ? search.as : "";
  const sortBy: PlayersSortBy =
    search.sort === "soonest" || search.sort === "nearest" || search.sort === "name"
      ? search.sort
      : "recent";
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

  // Sport chips: Basketball first, then the member's own sports, then the rest.
  const mySportsKey = (profile?.sports ?? []).map((s) => s.name).join("|");
  const sportPriority = useMemo(
    () => basketballFirstPriority(mySportsKey ? mySportsKey.split("|") : []),
    [mySportsKey],
  );

  const setSkills = (next: SportSkillMap) => {
    const safe = sanitizeSportSkillMap(next, sports);
    updateSearch({ skill: serializeSportSkillMap(safe, sports) }, { push: true });
  };

  const setMaxDistance = (v: number) => updateSearch({ dist: v });
  const setAgeMin = (v: number | "") => updateSearch({ ageMin: v === "" ? undefined : v });
  const setAgeMax = (v: number | "") => updateSearch({ ageMax: v === "" ? undefined : v });
  const setIncludeUnknownAge = (v: boolean) => updateSearch({ unknownAge: v });
  const setWhen = (v: "any" | "today" | "week" | "weekend") => updateSearch({ when: v });
  const setAvailableAs = (v: AvailabilityIntent | "") => updateSearch({ as: v });
  const setSortBy = (v: PlayersSortBy) => updateSearch({ sort: v });
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
  // Set after "Switch to my player profile": ask the posting check again once it settles, so a second reason (an
  // incomplete player profile) gets its own next step instead of a form that can't be posted.
  const [recheckGate, setRecheckGate] = useState(false);
  useEffect(() => {
    if (!recheckGate || availGate.loading) return;
    setRecheckGate(false);
    if (availGate.canPost) setPostOpen(true);
    else setGateOpen(true);
  }, [recheckGate, availGate.loading, availGate.canPost]);
  // New posts start with the three-tap "I'm available" sheet; "More options" opens the full form.
  const [quickOpen, setQuickOpen] = useState(false);
  const openPostFlow = () => {
    if (availGate.canPost) setQuickOpen(true);
    else setGateOpen(true);
  };

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
        if (!cancelled)
          toast.error(userErrorMessage(e, "Couldn't load that post. Please try again."));
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

  // With the viewer's location, Find Players asks the database (players_available_near, migration 20261114120000):
  // real distance within both radii, the "When" window in each post's timezone, intent, and paging. Without it, the
  // newest posts are listed as before.
  const { coords } = useUserLocation();
  // If the search is unavailable (an older database, a network error), fall back to the newest-posts list for this
  // visit rather than showing an empty page.
  const [serverSearchFailed, setServerSearchFailed] = useState(false);
  const serverSearch = !!coords && !serverSearchFailed;
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const nearQuery = (offset: number): NearbyAvailabilityQuery => {
    const { from, to } = availabilityWindowFor(when);
    return {
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      radiusMi: maxDistance > 0 ? maxDistance : NEARBY_DEFAULT_RADIUS_MI,
      sport: sports.length === 1 ? sports[0] : null,
      from: from.toISOString(),
      to: to.toISOString(),
      intent: availableAs || null,
      // Posts saved before locations were captured still show, after the located ones.
      includeUnlocated: true,
      order: sortBy === "soonest" ? "soonest" : "nearest",
      limit: NEARBY_PAGE_SIZE,
      offset,
    };
  };
  const loadMore = async () => {
    if (!serverSearch || loadingMore || !list) return;
    setLoadingMore(true);
    try {
      const next = await listAvailabilityNear(nearQuery(list.length));
      setList((cur) => {
        const seen = new Set((cur ?? []).map((a) => a.id));
        return [...(cur ?? []), ...next.filter((a) => !seen.has(a.id))];
      });
      setHasMore(next.length === NEARBY_PAGE_SIZE);
    } catch (e) {
      toast.error(userErrorMessage(e, "Couldn't load more players. Please try again."));
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    // Hold off until the saved view is restored, so the first fetch already
    // uses the user's sports rather than the empty defaults.
    if (!hydrated) return;
    let cancelled = false;
    setList(null);
    setHasMore(false);
    (serverSearch
      ? listAvailabilityNear(nearQuery(0)).then(
          (rows) => {
            if (!cancelled) setHasMore(rows.length === NEARBY_PAGE_SIZE);
            return rows as AvailabilityWithAuthor[];
          },
          (e) => {
            console.warn("players_available_near failed; listing newest posts instead", e);
            if (!cancelled) setServerSearchFailed(true);
            return listOpenAvailabilities({ sports });
          },
        )
      : listOpenAvailabilities({ sports })
    )
      .then((rows) => {
        if (!cancelled) setList(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setList([]);
          toast.error(userErrorMessage(e, "Couldn't load available players. Please try again."));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sportsKey,
    reloadTick,
    hydrated,
    serverSearch,
    coords?.lat,
    coords?.lng,
    // Without a location these are filtered in the browser; refetching on them is harmless.
    maxDistance,
    when,
    availableAs,
    sortBy,
  ]);

  const ageActive = ageMin !== "" || ageMax !== "";
  const activeFilterCount =
    (sports.length ? 1 : 0) +
    countSkillSelections(skills) +
    (maxDistance > 0 ? 1 : 0) +
    (ageActive ? 1 : 0) +
    (availableAs ? 1 : 0);

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
      if (
        !matchesSportSkillFilter(
          a.author_sport_levels,
          a.sports,
          a.skill_level,
          sports,
          skills,
          (s) => postTiersForSport(a, s),
        )
      )
        return false;
      if (availableAs && !parseIntents(a.looking_for).includes(availableAs)) return false;

      // The server search already measured distance and the time window.
      if (!serverSearch && maxDistance > 0 && kmToMi(a.travel_radius_km) > maxDistance)
        return false;
      if (!serverSearch && when !== "any") {
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
          // No birthday on file, or a minor whose age is only shown to their guardian:
          // include only when the user has opted in.
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
  }, [
    list,
    q,
    sportsKey,
    search.skill,
    maxDistance,
    ageMin,
    ageMax,
    includeUnknownAge,
    when,
    availableAs,
    serverSearch,
  ]);

  const sorted = useMemo(() => {
    if (!filtered) return null;
    const soonest = (a: AvailabilityWithAuthor) => {
      const dates = parseTimeSlots(a.time_slots ?? [])
        .map((sl) => ("date" in sl ? sl.date : null))
        .filter((d): d is string => Boolean(d))
        .sort();
      return dates[0] ?? a.starts_on ?? "9999-12-31";
    };
    const distMi = (a: AvailabilityWithAuthor) => {
      if (!coords || a.lat == null || a.lng == null) return Number.POSITIVE_INFINITY;
      return haversineKm(coords, { lat: a.lat, lng: a.lng }) * MI_PER_KM;
    };
    const out = [...filtered];
    // Nearest and Soonest come ordered from the server search (Array.prototype.sort is stable).
    if (serverSearch && (sortBy === "nearest" || sortBy === "soonest")) return out;
    out.sort((a, b) => {
      if (sortBy === "name") return a.author_name.localeCompare(b.author_name);
      if (sortBy === "soonest") return soonest(a).localeCompare(soonest(b));
      if (sortBy === "nearest") return distMi(a) - distMi(b);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return out;
  }, [filtered, sortBy, coords, serverSearch]);

  // Search results: warm the first screenful eagerly, the rest speculatively,
  // then let the viewport observer promote rows as they approach the screen.
  const resultIds = useMemo(() => (sorted ?? []).map((a) => a.user_id), [sorted]);
  usePrefetchUserAvatars(resultIds.slice(0, 8), "high");
  usePrefetchUserAvatars(resultIds.slice(8), "low");
  const avatarRowRef = useAvatarViewportPriority();

  return (
    <div className="page-shell-content pt-6">
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
        <h1 className="page-title">Players ready to run.</h1>
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

      {/* WP 4.1: your posts, game invitations and requests are on one screen. */}
      {!isParentMode && (
        <Link
          to="/availability"
          className="mb-4 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-sm font-bold"
        >
          <Inbox className="h-4 w-4 text-lime" aria-hidden /> My availability &amp; invitations
        </Link>
      )}

      <NearbyPlayersPanel
        players={list}
        mySports={profile?.sports?.map((s) => s.name)}
        myCity={profile?.city}
        currentUserId={user?.id ?? null}
      />

      {/* The layout switch (grid / compact / map) lives in the filter sheet, so the
              results start higher on a phone. Its URL keys (view, density) are unchanged. */}
      <FilterBar
        q={q}
        onQChange={setQ}
        searchPlaceholder="Search name, city, sport"
        activeFilterCount={activeFilterCount}
        sheetTitle="Filter players"
        rightExtra={
          isParentMode ? undefined : (
            <button
              onClick={openPostFlow}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-lime-gradient text-primary-foreground glow-lime"
              aria-label="I'm available: post availability"
            >
              <Plus className="h-5 w-5" strokeWidth={2.5} />
            </button>
          )
        }
        onReset={() => {
          markSportChoice("players");
          setSports([]);
          setMaxDistance(0);
          setAgeMin("");
          setAgeMax("");
          setIncludeUnknownAge(true);
          setAvailableAs("");
          setSortBy("recent");
        }}
        sheet={
          <PlayersFilterBody
            viewMode={viewMode}
            onViewChange={switchView}
            density={density}
            onDensityChange={switchDensity}
            sportPriority={sportPriority}
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
            sortBy={sortBy}
            setSortBy={setSortBy}
          />
        }
      />

      {/* Sport filter chips */}
      <div className="mb-3">
        <SportChips
          multi
          selected={sports}
          onSelect={toggleSportFilter}
          prioritize={sportPriority}
        />
      </div>

      {/* Availability filter chips */}
      <div className="bleed-x-gutter overflow-x-auto mb-4">
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
          <span aria-hidden className="mx-1 w-px shrink-0 self-stretch bg-border" />
          {AVAILABILITY_INTENTS.map((intent) => {
            const active = availableAs === intent;
            return (
              <button
                key={intent}
                aria-pressed={active}
                onClick={() => setAvailableAs(active ? "" : intent)}
                className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "border-lime bg-lime text-primary-foreground"
                    : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {INTENT_LABEL[intent]}
              </button>
            );
          })}
        </div>
      </div>

      {viewMode === "map" ? (
        <>
          {/* The layout switch is in the filter sheet; give the map its own way back. */}
          <PlayersMapHeader onShowList={() => switchView("list")} />
          <PlayersMapView players={sorted ?? []} />
        </>
      ) : sorted === null ? (
        <LoadingRows />
      ) : sorted.length === 0 ? (
        <EmptyState
          title={list && list.length > 0 ? "No matches" : "No one's posted yet"}
          body={
            list && list.length > 0
              ? "Try a different search or sport."
              : "Be the first — share when you're free and where you'll travel."
          }
          cta={
            isParentMode ? undefined : user ? (
              <Button
                onClick={openPostFlow}
                className="rounded-full bg-lime-gradient text-primary-foreground"
              >
                Post availability
              </Button>
            ) : (
              <Link
                to="/auth"
                search={authSearch}
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
            <h2 className="section-eyebrow text-muted-foreground">
              {sorted.length} player{sorted.length === 1 ? "" : "s"} available
            </h2>
            <SortSummary value={sortBy} options={PLAYER_SORTS} />
          </div>
          <ul
            className={
              density === "grid" ? "grid grid-cols-1 sm:grid-cols-2 gap-3 pb-6" : "space-y-3 pb-6"
            }
          >
            {sorted.map((a) => (
              <AvailabilityCard
                key={a.id}
                a={a}
                rowRef={avatarRowRef}
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
          {serverSearch && hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mb-6 flex min-h-11 w-full items-center justify-center rounded-full border border-border bg-surface text-sm font-bold"
            >
              {loadingMore ? "Loading…" : "Load more players"}
            </button>
          )}
        </>
      )}

      {!isParentMode && (
        <Dialog open={gateOpen} onOpenChange={(o) => !o && setGateOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Post availability</DialogTitle>
              <DialogDescription className="sr-only">
                {availabilityGateMessage(availGate.reason)}
              </DialogDescription>
            </DialogHeader>
            <AvailabilityRequiredNotice
              reason={availGate.reason}
              onSwitched={() => {
                setGateOpen(false);
                setRecheckGate(true);
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      {!isParentMode && (
        <QuickAvailabilitySheet
          open={quickOpen}
          onOpenChange={setQuickOpen}
          onPosted={() => {
            setQuickOpen(false);
            setReloadTick((t) => t + 1);
            toast.success("You're listed. Players near you can see when you're free.");
          }}
          onMoreOptions={() => {
            setQuickOpen(false);
            setPostOpen(true);
          }}
        />
      )}

      {!isParentMode && (postOpen || editingPost) && (
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
        <span className="absolute -top-1 -right-1 grid h-4 min-w-4 px-1 place-items-center rounded-full bg-coral-strong text-[10px] font-bold text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
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
  rowRef,
}: {
  a: AvailabilityWithAuthor;
  isMine: boolean;
  hasHostedGames: boolean;
  onContact: () => void;
  onOpen: () => void;
  onChanged: () => void;
  /** Marks the row so its avatar is prioritized as it nears the viewport. */
  rowRef?: (ids: Array<string | null | undefined>) => (el: Element | null) => void;
}) {
  const navigate = useNavigate();
  const when = formatWindow(a);
  const { teams: recruitingTeams } = useMyRecruitingTeams();
  const [teamInviteOpen, setTeamInviteOpen] = useState(false);
  const authorLinks: ProfileLink[] = Array.isArray(a.author_links)
    ? (a.author_links as ProfileLink[])
    : [];

  const guardianFallback = useMessageOrGuardian();
  const handleMessage = () => guardianFallback.startMessage(a.user_id, a.author_name);

  const handleDelete = async () => {
    if (!confirm("Remove this availability post?")) return;
    try {
      await deleteAvailability(a.id);
      toast.success("Removed");
      onChanged();
    } catch (e: any) {
      toast.error(userErrorMessage(e, "Couldn't remove this post. Please try again."));
    }
  };

  return (
    <li ref={rowRef?.([a.user_id])} className="rounded-2xl border border-border bg-surface p-4">
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
            <AvailabilityIntentBadges value={a.looking_for} className="justify-end" />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {a.sports.length === 0 ? (
              <span className="text-xs text-muted-foreground">Any sport</span>
            ) : (
              a.sports.map((s) => {
                const emoji = SPORTS.find((sp) => sp.name === s)?.emoji ?? "🎯";
                // Levels picked on this post win; otherwise show the profile tier.
                const postTiers = postTiersForSport(a, s);
                const levelText = postTiers.length
                  ? postTiers.join(" · ")
                  : formatSportLevel(parseSportLevels(a.author_sport_levels)[s] ?? null);
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
              {typeof a.distance_mi === "number" && (
                <>
                  <span className="font-semibold text-foreground">
                    <Distance mi={a.distance_mi} /> away
                  </span>{" "}
                  ·{" "}
                </>
              )}
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
              (a.sports[0] ? postTiersForSport(a, a.sports[0]).join(" · ") : "") ||
              formatSportLevel(
                resolvePlayerLevel(a.author_sport_levels, a.sports[0] ?? null, a.skill_level),
              ) ||
              "—",
          },
          { label: "Sports", value: a.sports.length ? String(a.sports.length) : "Any" },
          { label: "Travels", value: <Distance km={a.travel_radius_km} /> },
        ].map((s) => (
          <div key={s.label}>
            <dt className="micro-label text-muted-foreground">{s.label}</dt>
            <dd className="truncate text-xs font-semibold">{s.value}</dd>
          </div>
        ))}
      </dl>

      {/* About — the player's profile bio + key identity details + links. */}
      {(a.author_bio || a.author_city || a.travel_radius_km > 0 || authorLinks.length > 0) && (
        <div className="mt-3 rounded-2xl border border-border bg-background/40 p-3">
          {a.author_bio && (
            <section>
              <h2 className="mb-1.5 section-eyebrow text-muted-foreground">About</h2>
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

      {!isMine && recruitingTeams.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full rounded-full border-lime/50"
          onClick={() => setTeamInviteOpen(true)}
        >
          <Shield className="h-4 w-4 mr-1" /> Invite to team
        </Button>
      )}
      {guardianFallback.dialog}
      {teamInviteOpen && (
        <InviteToTeamDialog
          playerId={a.user_id}
          playerName={a.author_name}
          onClose={() => setTeamInviteOpen(false)}
        />
      )}

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

const formatWindow = (a: PlayerAvailability): string => formatAvailabilityWindowShort(a);

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

  // WP 2.0: an invitation goes through the server (game_invite_player), which checks the game and the player and writes
  // the notification from the real game. Its status comes from game_invites, not from the old contact requests.
  const [invite, setInvite] = useState<GameInvite | null>(null);
  useEffect(() => {
    if (!isInvite || !selected) {
      setInvite(null);
      return;
    }
    let live = true;
    findGameInvite(selected.id, availability.user_id)
      .then((row) => live && setInvite(row))
      .catch(() => live && setInvite(null));
    return () => {
      live = false;
    };
  }, [isInvite, selected, availability.user_id, refreshKey]);
  const invitePending = invite?.status === "pending";

  const withdraw = async () => {
    if (!invite) return;
    setSaving(true);
    try {
      await cancelGameInvite(invite.id);
      toast.success("Invite withdrawn");
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(gameInviteErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const send = async () => {
    setSaving(true);
    try {
      if (isInvite) {
        if (!selected) return;
        await inviteToGame(selected.id, availability.user_id, {
          availabilityId: availability.id,
          message: msg,
        });
        toast.success("Invite sent");
        onClose();
        return;
      }
      await createContactRequest(availability.id, availability.user_id, msg.trim(), null);
      toast.success("Contact request sent");
      onClose();
    } catch (e: any) {
      if (isInvite) {
        toast.error(gameInviteErrorMessage(e));
        setRefreshKey((k) => k + 1);
        return;
      }
      const msg = String(e?.message ?? "");
      if (msg.includes("duplicate") || (e as { code?: string })?.code === "23505") {
        toast.error("You already have a pending request to this player.");
        setRefreshKey((k) => k + 1);
      } else
        toast.error(
          ownErrorSentence(e) ??
            userErrorMessage(e, "Couldn't send your request. Please try again."),
        );
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

        {isInvite ? (
          invitePending && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3 text-sm">
              <span>Invite sent. Waiting for {availability.author_name} to answer.</span>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => void withdraw()}>
                Withdraw
              </Button>
            </div>
          )
        ) : (
          <RequestStatusPanel
            availabilityId={availability.id}
            gameId={null}
            refreshKey={refreshKey}
            onLoaded={(s: ExistingRequestSummary) => setExistingStatus(s.status)}
            onCancelled={() => setExistingStatus("none")}
          />
        )}

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
            disabled={saving || (isInvite ? invitePending || !selected : isPending)}
            className="bg-lime-gradient text-primary-foreground"
          >
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {isInvite
              ? invitePending
                ? "Invite pending"
                : "Send invite"
              : isPending
                ? "Request pending"
                : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

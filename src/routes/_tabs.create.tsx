import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Users,
  DollarSign,
  Lock,
  Home,
  ShieldCheck,
  ImagePlus,
  Clock3,
} from "lucide-react";
import { SPORTS, type Sport, imageFor } from "@/lib/sample-data";
import { TierChips } from "@/components/sports/TierChips";
import { addHostedGame } from "@/lib/hosted-games-store";
import { SIGNUP_CUTOFF_PRESETS } from "@/lib/live-status";
import {
  ANY_SKILL,
  parseSkillTiers,
  scaleForSport,
  serializeSkillTiers,
  toggleSkillTier,
} from "@/lib/sport-levels";
import { useServerFn } from "@tanstack/react-start";
import { geocodeAddress, reverseGeocode } from "@/lib/geocode.functions";
import { listMyTeams } from "@/lib/teams.functions";
import { getOrgEventContext, listMyManagedOrgs } from "@/lib/trainer-orgs.functions";
import {
  defaultFacilityEventTitle,
  facilityEventKindLabel,
  isFacilityEventKind,
  type FacilityEventKind,
} from "@/lib/facility-events";
import { useQuery } from "@tanstack/react-query";
import { useMyProfiles } from "@/lib/account-profiles";

import { toast } from "sonner";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { useMyProfile } from "@/lib/user-prefs-store";
import { useDefaultSports } from "@/lib/default-sports";
import { useAuth } from "@/hooks/use-auth";
import { useAvailabilityGate } from "@/lib/availability-gate";
import { AvailabilityPromptBanner } from "@/components/availability/AvailabilityPromptDialog";
import { upsertGamePaymentSettings } from "@/lib/payments";
import { ImageUploader } from "@/components/ImageUploader";
import {
  PositionsPicker,
  positionsCleanup,
  type PositionsNeeded,
} from "@/components/PositionsPicker";
import { GameScheduleBuilder } from "@/components/create/GameScheduleBuilder";
import { DateTimeRangePicker } from "@/components/datetime/DateTimeRangePicker";
import { resolveTimeZone, timeZoneAbbr, todayKeyInZone } from "@/lib/datetime";
import {
  defaultWhenRange,
  durationToText,
  scheduleToPlans,
  validateSchedule,
  validateWhenRange,
  whenRangeToPlan,
  type GamePlan,
  type ScheduleEntry,
  type WhenRange,
} from "@/lib/game-schedule";
import { AgeRequirementFields } from "@/components/games/AgeRequirementFields";
import { HostResponsibilityNotice } from "@/components/safety/HostResponsibilityNotice";
import { GamePolicyFields } from "@/components/games/GamePolicyFields";
import { GamePolicySummary } from "@/components/games/GamePolicySummary";
import { defaultGamePolicy, validateGamePolicy, type GamePolicy } from "@/lib/game-policy";
import { recordSafetyAck } from "@/lib/safety-acks";
import { useMyChildStatus } from "@/lib/child-safety";
import { HOSTING_BLOCKED_MESSAGE } from "@/lib/hosting-policy";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_tabs/create")({
  head: () =>
    pageHead({
      path: "/create",
      title: "Create a Pickup Sports Game | BallaCity",
      description: "Set up a pickup game: sport, venue, time, spots, and entry fee.",
      noindex: true,
    }),
  // `orgId` / `kind` come from a facility page's "Host a run here" action.
  // The org is looked up server-side before anything is pre-filled.
  validateSearch: (
    search: Record<string, unknown>,
  ): { orgId?: string; kind?: FacilityEventKind } => ({
    orgId:
      typeof search.orgId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search.orgId)
        ? search.orgId
        : undefined,
    kind: isFacilityEventKind(search.kind) ? search.kind : undefined,
  }),
  component: Create,
});

function Create() {
  const nav = useNavigate();
  const { orgId: orgIdParam, kind: requestedKind = "run" } = Route.useSearch();
  // The facility this run is hosted at: from the facility page link, or picked
  // in the "Host at a facility" selector.
  const [facilityId, setFacilityId] = useState<string | null>(orgIdParam ?? null);
  const { user } = useAuth();
  const profile = useMyProfile(user);
  const { can: canFeature } = useMyChildStatus();
  const hostingDecision = canFeature("game_hosting");
  const fetchMyTeams = useServerFn(listMyTeams);
  const myTeamsQuery = useQuery({
    queryKey: ["my-teams", user?.id ?? "anon"],
    queryFn: () => fetchMyTeams(),
    enabled: !!user,
    staleTime: 30_000,
  });
  const myTeams = myTeamsQuery.data ?? [];
  type Affiliation = {
    source: "team";
    id: string;
    name: string;
    kind?: "team" | "coach";
  };
  // Games are always published under a team profile the account owns.
  const affiliations: Affiliation[] = myTeams
    .filter((t) => t.kind !== "coach")
    .map((t) => ({ source: "team" as const, id: t.id, name: t.name, kind: t.kind }));
  const affiliationsLoading = myTeamsQuery.isLoading;
  const { active: activeProfile } = useMyProfiles();
  const activeRefId = activeProfile && activeProfile.kind === "team" ? activeProfile.refId : null;
  const [selectedAffiliation, setSelectedAffiliation] = useState<Affiliation | null>(null);
  const hostAsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (affiliationsLoading) return;
    if (affiliations.length === 0) {
      setSelectedAffiliation(null);
      return;
    }
    // Prefer the team the app is currently acting as, then fall back to the
    // only team the account owns.
    const preferred =
      (activeRefId ? affiliations.find((a) => a.id === activeRefId) : undefined) ??
      (affiliations.length === 1 ? affiliations[0] : undefined);
    if (preferred) setSelectedAffiliation((cur) => cur ?? preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affiliations.length, affiliationsLoading, activeRefId]);
  const affiliationLabel = (_a: Affiliation) => "Team";
  const affiliationShortLabel = affiliationLabel;

  const [sport, setSport] = useState<Sport>("Basketball");
  // Default to the viewer's first favorite sport once the profile has loaded,
  // unless they already picked one themselves.
  const { sports: profileSports, loaded: profileSportsLoaded } = useDefaultSports();
  const sportTouchedRef = useRef(false);
  useEffect(() => {
    if (sportTouchedRef.current || !profileSportsLoaded) return;
    const first = profileSports[0];
    if (first) setSport(first as Sport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileSportsLoaded, profileSports.join("|")]);
  const pickSport = (next: Sport) => {
    sportTouchedRef.current = true;
    setSport(next);
  };

  const [title, setTitle] = useState("");
  const [when, setWhen] = useState<WhenRange>(() => defaultWhenRange());
  // Wall-clock entries are interpreted in the host's own zone.
  const eventTimeZone = resolveTimeZone(null);
  const [location, setLocation] = useState(profile?.city ?? "");
  const previousProfileCityRef = useRef(profile?.city ?? "");
  const locationEditedRef = useRef(false);
  // Skill options follow the picked sport's real scale (Flag / 7v7 /
  // Full contact for Football) so a game reads like a profile tier.
  const [skill, setSkill] = useState<string>(ANY_SKILL);
  const selectedSkillTiers = parseSkillTiers(sport, skill);
  const skillMulti = scaleForSport(sport).multi ?? false;
  useEffect(() => {
    if (skill === ANY_SKILL) return;
    const kept = serializeSkillTiers(sport, parseSkillTiers(sport, skill));
    if (kept !== skill) setSkill(kept);
  }, [sport, skill]);
  const [price, setPrice] = useState(0);
  const [indoor, setIndoor] = useState(false);
  const [priv, setPriv] = useState(false);
  const [description, setDescription] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(true);
  // Host-configurable game policy (limits, waitlist, cancellation, rules).
  const [policy, setPolicy] = useState<GamePolicy>(() => defaultGamePolicy(10));
  const size = policy.maxPlayers;
  const policyRef = useRef<HTMLDivElement | null>(null);
  // Payment requirement + approval live in their own controls; mirror them in
  // the policy object so the preview players see matches reality.
  const effectivePolicy: GamePolicy = { ...policy, entryFee: price, requiresApproval };
  const [minAge, setMinAge] = useState<number | null>(null);
  const [maxAge, setMaxAge] = useState<number | null>(null);
  const [signupCutoffMin, setSignupCutoffMin] = useState(0);
  const [publishing, setPublishing] = useState(false);
  // Host responsibility acknowledgment (never pre-checked, recorded per game).
  const [hostAck, setHostAck] = useState(false);
  const hostAckRef = useRef<HTMLDivElement | null>(null);

  // Nudge hosts to keep their own player availability up to date.
  const hostAvailGate = useAvailabilityGate();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [positionsNeeded, setPositionsNeeded] = useState<PositionsNeeded>({});
  const [multiDay, setMultiDay] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);

  useEffect(() => {
    const nextCity = profile?.city?.trim() ?? "";
    const previousCity = previousProfileCityRef.current;
    if (nextCity === previousCity) return;
    previousProfileCityRef.current = nextCity;

    if (!nextCity) return;
    // Don't clobber an address the user already typed or that GPS auto-filled.
    if (locationEditedRef.current) return;
    if (location.trim()) return;
    setLocation(nextCity);
    // location intentionally read at effect-time only; we don't want the
    // effect to re-fire whenever location changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.city]);

  // Auto-fill the venue address from the device's current GPS location when
  // the user hasn't typed anything yet. Runs once on mount; manual edits or
  // a profile-city value present at mount take precedence.
  const reverse = useServerFn(reverseGeocode);
  const geocode = useServerFn(geocodeAddress);
  // Real venue coordinates, used to compute each viewer's distance to the game.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Facility run: any signed-in host can list a public run at a facility.
  // Owners/admins post official events; everyone else posts a community run
  // (the `hosted_games` trigger sets `org_official`, not this page).
  const fetchOrgContext = useServerFn(getOrgEventContext);
  const fetchManagedOrgs = useServerFn(listMyManagedOrgs);
  const managedOrgsQuery = useQuery({
    queryKey: ["my-managed-orgs", user?.id ?? "anon"],
    queryFn: () => fetchManagedOrgs(),
    enabled: !!user,
    staleTime: 60_000,
  });
  const managedOrgs = managedOrgsQuery.data ?? [];
  const orgContextQuery = useQuery({
    queryKey: ["org-event-context", facilityId, user?.id ?? "anon"],
    queryFn: () => fetchOrgContext({ data: { orgId: facilityId! } }),
    enabled: !!facilityId && !!user,
    staleTime: 60_000,
  });
  const postingOrg = orgContextQuery.data?.org ?? null;
  const postingOfficial = !!orgContextQuery.data?.official;
  // Tournaments, clinics and open-court sessions are the facility's own events.
  const eventKind: FacilityEventKind = postingOfficial ? requestedKind : "run";
  // Which facility's details were last filled in, and the title we generated,
  // so switching facilities refreshes them without clobbering a typed title.
  const prefilledForRef = useRef<string | null>(null);
  const autoTitleRef = useRef("");
  useEffect(() => {
    if (!postingOrg) {
      prefilledForRef.current = null;
      return;
    }
    if (prefilledForRef.current === postingOrg.id) return;
    prefilledForRef.current = postingOrg.id;
    // The facility's venue wins over the GPS / profile-city auto-fill.
    locationEditedRef.current = true;
    setLocation(postingOrg.address || postingOrg.name);
    setCoords(
      postingOrg.lat != null && postingOrg.lng != null
        ? { lat: postingOrg.lat, lng: postingOrg.lng }
        : null,
    );
    const nextTitle = defaultFacilityEventTitle(eventKind, postingOrg.name);
    setTitle((cur) => (!cur || cur === autoTitleRef.current ? nextTitle : cur));
    autoTitleRef.current = nextTitle;
    const amenities = postingOrg.amenities.join(" ").toLowerCase();
    if (/indoor|hardwood/.test(amenities)) setIndoor(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postingOrg]);
  useEffect(() => {
    if (locationEditedRef.current) return;
    if (location.trim()) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (cancelled || locationEditedRef.current) return;
        try {
          const res = await reverse({
            data: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          });
          const next = res?.formatted || res?.city;
          if (next && !cancelled && !locationEditedRef.current) {
            // Mark as edited so a late-loading profile.city doesn't overwrite.
            locationEditedRef.current = true;
            setLocation(next);
            setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          }
        } catch {
          /* silent — user can still type manually */
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );

    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLocationChange = (next: string) => {
    locationEditedRef.current = true;
    setLocation(next);
    // Typing invalidates any previously picked venue coordinates; we re-resolve
    // them from the address on publish so distance is always real.
    setCoords(null);
  };

  if (!user) {
    return (
      <div className="page-shell-content pt-6">
        <div className="flex items-center gap-3 mb-5">
          <Link
            to="/feed"
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="page-title">Host a game</h1>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 text-center space-y-4">
          <ShieldCheck className="h-8 w-8 mx-auto text-lime" />
          <div>
            <h2 className="font-display text-lg font-bold">Sign in to host</h2>
            <p className="text-sm text-muted-foreground mt-1">
              You need an account so we can lock in host controls and let players contact you.
            </p>
          </div>
          <Link
            to="/auth"
            search={{ redirect: "/create" } as any}
            className="inline-block w-full rounded-2xl bg-lime-gradient py-3 font-bold text-primary-foreground glow-lime"
          >
            Sign in to host a game
          </Link>
        </div>
      </div>
    );
  }

  // Age gate (UX mirror of the `block_child_hosting` DB trigger).
  if (!hostingDecision.allowed) {
    return (
      <div className="page-shell-content pt-6">
        <div className="flex items-center gap-3 mb-5">
          <Link
            to="/feed"
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="page-title">Host a game</h1>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 space-y-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> Hosting
          </div>
          <h2 className="font-display text-lg font-bold">{HOSTING_BLOCKED_MESSAGE}</h2>
          <p className="text-sm text-muted-foreground">
            {hostingDecision.reason ||
              "An adult account has to host games. Ask a parent, guardian or coach to set the game up for you."}
          </p>
        </div>
      </div>
    );
  }

  // Gate: games are always published under a team profile.

  if (affiliationsLoading) {
    return (
      <div className="page-shell-content pt-6">
        <div className="h-8 w-40 bg-surface rounded-lg animate-pulse mb-4" />
        <div className="h-32 bg-surface rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (affiliations.length === 0) {
    return (
      <div className="page-shell-content pt-6">
        <div className="flex items-center gap-3 mb-5">
          <Link
            to="/feed"
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="page-title">Host a game</h1>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 text-center space-y-4">
          <ShieldCheck className="h-8 w-8 mx-auto text-lime" />
          <div>
            <h2 className="font-display text-lg font-bold">Host as a team</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Games are published under a team profile so players know who they're joining. Add a
              team profile to your account to start hosting — your other profiles stay as they are.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <Link
              to="/teams/create"
              className="rounded-2xl bg-lime-gradient py-3 font-bold text-primary-foreground glow-lime"
            >
              Create a team
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell-content pt-6">
      <div className="flex items-center gap-3 mb-5">
        {orgIdParam ? (
          <Link
            to="/orgs/$orgId"
            params={{ orgId: orgIdParam }}
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        ) : (
          <Link
            to="/feed"
            className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        )}
        <h1 className="page-title">
          {postingOrg && postingOfficial ? "Post an event" : "Host a game"}
        </h1>
      </div>

      {facilityId && orgContextQuery.isLoading && (
        <div className="mb-4 h-14 animate-pulse rounded-2xl bg-surface" />
      )}
      {postingOrg && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-lime/30 bg-lime/10 px-4 py-3 text-xs">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-lime" />
          <div className="min-w-0">
            <div className="font-bold text-foreground">
              {postingOfficial
                ? `${facilityEventKindLabel(eventKind)} at ${postingOrg.name}`
                : `Community run at ${postingOrg.name}`}
            </div>
            <div className="text-muted-foreground">
              {priv && !postingOfficial
                ? "Private games aren't listed on the facility page. Make it public to list it there."
                : `Your run will be listed on ${postingOrg.name}'s page. Location and address are pre-filled — you can still change any detail below.`}
            </div>
          </div>
        </div>
      )}
      {facilityId && orgContextQuery.data && !orgContextQuery.data.org && (
        <div className="mb-4 rounded-2xl border border-coral/40 bg-coral/10 px-4 py-3 text-xs text-coral">
          That facility isn&apos;t available, so it won&apos;t be attached to this game.
        </div>
      )}
      {facilityId && orgContextQuery.isError && (
        <div className="mb-4 rounded-2xl border border-coral/40 bg-coral/10 px-4 py-3 text-xs text-coral">
          Couldn&apos;t load that facility, so it won&apos;t be attached to this game.
        </div>
      )}

      {managedOrgs.length > 0 && (
        <label className="mb-4 block rounded-2xl border border-border bg-surface p-4">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Host at a facility
          </span>
          <select
            value={facilityId ?? ""}
            onChange={(e) => setFacilityId(e.target.value || null)}
            className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime/60"
          >
            <option value="">Not at a listed facility</option>
            {managedOrgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.city ? ` · ${o.city}` : ""}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-[11px] text-muted-foreground">
            Fills in the address and map pin, and lists the run on the facility&apos;s page.
          </span>
        </label>
      )}

      {!hostAvailGate.loading && !hostAvailGate.hasOpenAvailability && (
        <AvailabilityPromptBanner className="mb-4" />
      )}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (publishing) return;
          if (facilityId && orgContextQuery.isLoading) {
            toast.error("Still loading the facility details — try again in a moment.");
            return;
          }
          if (!user) {
            toast.error("Sign in to host a game");
            nav({ to: "/auth", search: { redirect: "/create" } as any });
            return;
          }
          if (!selectedAffiliation) {
            toast.error("Pick which team profile you're hosting as");
            hostAsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            hostAsRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
            return;
          }
          const policyCheck = validateGamePolicy(effectivePolicy);
          if (!policyCheck.ok) {
            toast.error(policyCheck.error);
            policyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
          }
          if (!hostAck) {
            toast.error("Acknowledge your host responsibilities to publish");
            hostAckRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
          }
          setPublishing(true);

          try {
            // Compute one or many start times, each with its own length.
            let plans: GamePlan[];
            if (multiDay) {
              const check = validateSchedule(schedule, new Date(), eventTimeZone);
              if (!check.ok) {
                toast.error(check.error ?? "Fix the schedule to continue.");
                setPublishing(false);
                return;
              }
              plans = scheduleToPlans(schedule, eventTimeZone);
            } else {
              const check = validateWhenRange(when, new Date(), eventTimeZone);
              if (!check.ok) {
                toast.error(check.error ?? "Fix the date and time to continue.");
                setPublishing(false);
                return;
              }
              plans = [whenRangeToPlan(when, eventTimeZone)];
            }

            // Build the host snapshot from the freshest profile available so
            // it never falls back to an email-prefix default when the
            // in-memory profile hasn't loaded yet. See host-snapshot.test.ts.
            const { supabase } = await import("@/integrations/supabase/client");
            const { resolveHostSnapshot } = await import("@/lib/host-snapshot");
            const hostSnap = await resolveHostSnapshot({
              userId: user.id,
              userEmail: user.email,
              fallback: profile
                ? {
                    name: profile.name,
                    username: profile.username,
                    avatar: profile.avatar,
                    rating: profile.stats.sportsmanship,
                  }
                : null,
              fetchDbProfile: async (id) => {
                const { data } = await supabase
                  .from("profiles")
                  .select("display_name, username, avatar_initials, avatar_url")
                  .eq("id", id)
                  .maybeSingle();
                return data as any;
              },
            });

            // Resolve venue coordinates: prefer what the autocomplete gave us,
            // otherwise geocode the typed address. Missing geo is not fatal —
            // the game just won't show a distance until it's geocoded.
            let venue = coords;
            if (!venue && location.trim()) {
              try {
                const res = await geocode({ data: { address: location.trim() } });
                venue = { lat: res.lat, lng: res.lng };
                setCoords(venue);
              } catch {
                venue = null;
              }
            }

            const cleanPositions = positionsCleanup(positionsNeeded);
            let firstGameId: string | null = null;
            // One shared series id links all sessions of a multi-day event so
            // the feed renders a single card instead of one card per day.
            const seriesId = plans.length > 1 ? crypto.randomUUID() : undefined;
            for (const plan of plans) {
              const game = await addHostedGame({
                sport,
                title,
                date: plan.startIso,
                duration: durationToText(plan.durationMin),
                location,
                skill,
                maxPlayers: size,
                price,
                indoor,
                isPrivate: priv,
                description,
                hostUserId: user?.id,
                host: hostSnap,
                image: coverUrl ?? undefined,
                positionsNeeded: cleanPositions,
                signupCutoffMin,
                minAge,
                maxAge,
                teamId: selectedAffiliation?.id,
                // Only public runs can be listed at someone else's facility.
                orgId: postingOrg && (postingOfficial || !priv) ? postingOrg.id : undefined,
                seriesId,
                endsAt: plan.endIso,
                allDay: plan.allDay,
                timezone: plan.timezone,
                lat: venue?.lat ?? null,
                lng: venue?.lng ?? null,
                minPlayers: effectivePolicy.minPlayers,
                allowWaitlist: effectivePolicy.allowWaitlist,
                cancellationPolicy: effectivePolicy.cancellationPolicy,
                cancellationNotes: effectivePolicy.cancellationNotes || null,
                gameRules: effectivePolicy.gameRules || null,
              });

              if (!firstGameId) firstGameId = game.id;

              // Record the host's responsibility acknowledgment for this game.
              void recordSafetyAck({ gameId: game.id, kind: "host_responsibility" }).catch(
                () => {},
              );

              // Persist host ownership + approval/fee preferences so the host & players see them on the detail page
              try {
                await upsertGamePaymentSettings({
                  game_id: game.id,
                  entry_fee: price,
                  accepted_method_ids: [],
                  requires_approval: requiresApproval,
                  refund_policy: effectivePolicy.refundPolicy || null,
                  ...(price > 0
                    ? {
                        refund_rule: effectivePolicy.refundRule,
                        late_refund_pct: effectivePolicy.lateRefundPct,
                      }
                    : {}),
                });
              } catch (err: any) {
                toast.error(err?.message ?? "Saved game, but couldn't lock host ownership.");
              }
            }

            // Note: do NOT auto-join the host. Hosting ≠ playing; the host
            // sees their published games in the profile's hosted section.
            if (plans.length > 1) {
              toast.success(`Created ${plans.length} games`);
              nav({ to: "/feed" });
            } else {
              toast.success("Game published");
              nav({ to: "/games/$gameId", params: { gameId: firstGameId! } });
            }
          } finally {
            setPublishing(false);
          }
        }}
        className="space-y-5"
      >
        {/* Host as (team/club) */}
        <div
          ref={hostAsRef}
          className={`rounded-2xl ${
            !selectedAffiliation && affiliations.length > 1
              ? "border border-destructive/60 bg-destructive/5 p-3"
              : ""
          }`}
        >
          <Section
            title="Host as"
            right={
              !selectedAffiliation && affiliations.length > 1 ? (
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 micro-label text-destructive">
                  Required
                </span>
              ) : undefined
            }
          >
            {affiliations.length === 1 ? (
              <div className="flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-lime/10 text-lime text-sm font-bold shrink-0">
                    {(affiliations[0].name || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{affiliations[0].name}</div>
                    <div className="micro-label text-muted-foreground">
                      {affiliationLabel(affiliations[0])}
                    </div>
                  </div>
                </div>
                <span className="text-[11px] text-muted-foreground">Auto-selected</span>
              </div>
            ) : (
              <>
                <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
                  {affiliations.map((a) => {
                    const active =
                      selectedAffiliation?.source === a.source && selectedAffiliation.id === a.id;
                    return (
                      <button
                        type="button"
                        key={`${a.source}:${a.id}`}
                        onClick={() => setSelectedAffiliation(a)}
                        className={`shrink-0 flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold ${
                          active
                            ? "border-lime bg-lime/10 text-lime"
                            : "border-border bg-surface text-muted-foreground"
                        }`}
                      >
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-background text-xs font-bold">
                          {(a.name || "?").slice(0, 1).toUpperCase()}
                        </span>
                        <span className="truncate max-w-[10rem]">{a.name}</span>
                        <span className="micro-label opacity-70">{affiliationShortLabel(a)}</span>
                      </button>
                    );
                  })}
                </div>
                {!selectedAffiliation && (
                  <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                    Pick the team profile you're hosting as to continue.
                  </p>
                )}
              </>
            )}
          </Section>
        </div>

        <fieldset
          disabled={!selectedAffiliation}
          className={`space-y-5 border-0 p-0 m-0 min-w-0 ${
            !selectedAffiliation ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          <Section title="Sport">
            <div className="grid grid-cols-3 gap-2">
              {SPORTS.map((s) => {
                const active = sport === s.name;
                return (
                  <button
                    type="button"
                    key={s.name}
                    onClick={() => {
                      pickSport(s.name);
                      setPositionsNeeded({});
                    }}
                    className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-semibold transition-all ${
                      active
                        ? "border-lime bg-lime/10 text-lime"
                        : "border-border bg-surface text-muted-foreground"
                    }`}
                  >
                    <span className="text-2xl">{s.emoji}</span>
                    <span>{s.name}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* Cover photo */}
          <Section title="Cover photo" icon={<ImagePlus className="h-4 w-4" />}>
            <ImageUploader
              kind="cover"
              bucket="game-covers"
              pathPrefix={user?.id}
              value={coverUrl ?? ""}
              fallback={imageFor(sport)}
              onChange={setCoverUrl}
              onClear={() => setCoverUrl(null)}
              presets={[sport]}
              allowBgRemoval={false}
            />
          </Section>

          {/* Title */}
          <Section title="Game title">
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Friday Night Run · 5v5 Full Court"
              className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
            />
          </Section>

          {/* When */}
          <Section title="When" icon={<Calendar className="h-4 w-4" />}>
            <div
              role="group"
              aria-label="Schedule mode"
              className="flex gap-1 rounded-full border border-border bg-surface p-1"
            >
              {[
                { label: "One day", multi: false },
                { label: "Multiple days", multi: true },
              ].map((m) => (
                <button
                  key={m.label}
                  type="button"
                  aria-pressed={multiDay === m.multi}
                  onClick={() => setMultiDay(m.multi)}
                  className={`flex-1 rounded-full px-3 py-2 text-[13px] font-semibold transition-colors ${
                    multiDay === m.multi
                      ? "bg-lime text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {multiDay ? (
              <GameScheduleBuilder value={schedule} onChange={setSchedule} />
            ) : (
              <DateTimeRangePicker
                value={when}
                onChange={setWhen}
                todayKey={todayKeyInZone(eventTimeZone)}
                timeZoneLabel={`${timeZoneAbbr(new Date(), eventTimeZone)} · ${eventTimeZone.split("/").pop()?.replace(/_/g, " ")}`}
              />
            )}
          </Section>

          {/* Venue address */}
          <Section title="Venue address" icon={<MapPin className="h-4 w-4" />}>
            <LocationAutocomplete
              value={location}
              onChange={handleLocationChange}
              onPick={(_v, _placeId, geo) => {
                if (geo) setCoords({ lat: geo.lat, lng: geo.lng });
              }}
              placeholder="Search court, park or venue"
            />
            {profile?.city && (
              <p className="px-1 text-[11px] text-muted-foreground">
                Pre-filled from your profile city — refine with search above.
              </p>
            )}
          </Section>

          {/* Skill */}
          <Section title={`Skill level · ${scaleForSport(sport).system}`}>
            <TierChips
              scale={scaleForSport(sport)}
              selected={selectedSkillTiers}
              size="lg"
              ariaPrefix={sport}
              onToggle={(tier) => setSkill(toggleSkillTier(sport, skill, tier))}
              leading={
                <button
                  type="button"
                  aria-pressed={selectedSkillTiers.length === 0}
                  onClick={() => setSkill(ANY_SKILL)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${
                    selectedSkillTiers.length === 0
                      ? "border-lime bg-lime text-primary-foreground"
                      : "border-border bg-surface text-muted-foreground"
                  }`}
                >
                  {ANY_SKILL}
                </button>
              }
            />
            {skillMulti && (
              <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                Pick a level in each format you welcome — selections combine (e.g. "Flag Rec · 7v7
                Elite").
              </p>
            )}
          </Section>

          {/* Positions needed */}
          <Section title="Positions needed">
            <PositionsPicker sport={sport} value={positionsNeeded} onChange={setPositionsNeeded} />
          </Section>

          {/* Toggles */}
          <Section title="Details">
            <div className="rounded-2xl border border-border bg-surface px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2.5 text-sm">
                  <DollarSign
                    className={`h-4 w-4 ${price > 0 ? "text-lime" : "text-muted-foreground"}`}
                  />
                  <span className="font-medium">Paid game</span>
                </span>
                <button
                  type="button"
                  onClick={() => setPrice(price > 0 ? 0 : 10)}
                  className={`relative h-6 w-10 rounded-full transition-colors ${price > 0 ? "bg-lime" : "bg-secondary"}`}
                  aria-label="Toggle paid game"
                >
                  <motion.span
                    layout
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    className="absolute top-0.5 h-5 w-5 rounded-full bg-background shadow"
                    style={{ left: price > 0 ? "calc(100% - 1.375rem)" : "0.125rem" }}
                  />
                </button>
              </div>
              {price > 0 && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="section-eyebrow text-muted-foreground">Entry fee</span>
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      $
                    </span>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full rounded-xl border border-border bg-background pl-7 pr-3 py-2 text-sm outline-none focus:border-lime"
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">per player</span>
                </div>
              )}
            </div>
            <Toggle
              icon={<Home className="h-4 w-4" />}
              label="Indoor venue"
              value={indoor}
              onChange={setIndoor}
            />
            <Toggle
              icon={<Lock className="h-4 w-4" />}
              label="Private (invite only)"
              value={priv}
              onChange={setPriv}
            />
            <Toggle
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Require my approval to join"
              value={requiresApproval}
              onChange={setRequiresApproval}
              right={user ? undefined : "Sign in"}
            />
            {requiresApproval && (
              <p className="px-1 text-[11px] text-muted-foreground">
                Players send a pickup request and you approve or decline each one from the game
                page.
              </p>
            )}
            <AgeRequirementFields
              minAge={minAge}
              maxAge={maxAge}
              onChange={(n) => {
                setMinAge(n.minAge);
                setMaxAge(n.maxAge);
              }}
              idPrefix="create-age"
            />
            <div className="rounded-2xl border border-border bg-surface px-4 py-3">
              <label
                htmlFor="create-signup-cutoff"
                className="flex items-center gap-2 text-sm font-semibold"
              >
                <Clock3 className="h-4 w-4" /> Signup cutoff
              </label>
              <select
                id="create-signup-cutoff"
                value={String(signupCutoffMin)}
                onChange={(e) => setSignupCutoffMin(Number(e.target.value) || 0)}
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
              >
                {SIGNUP_CUTOFF_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                New signups close automatically this long before start. The game then shows "Signup
                closed", and "In progress" once it starts.
              </p>
            </div>
          </Section>

          {/* Game policy */}
          <div ref={policyRef}>
            <Section title="Game policy" icon={<Users className="h-4 w-4" />}>
              <GamePolicyFields
                value={effectivePolicy}
                onChange={setPolicy}
                idPrefix="create-policy"
              />
            </Section>
          </div>

          {/* What players will see */}
          <Section title="What players see before joining">
            <GamePolicySummary policy={effectivePolicy} defaultOpen />
          </Section>

          {/* Description */}
          <Section title="Description">
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Format, vibe, what to bring..."
              className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime resize-none"
            />
          </Section>

          {/* Host responsibility */}
          <div ref={hostAckRef}>
            <Section title="Host responsibility" icon={<ShieldAlert className="h-4 w-4" />}>
              <HostResponsibilityNotice accepted={hostAck} onChange={setHostAck} />
            </Section>
          </div>

          <motion.button
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={publishing || !selectedAffiliation || !hostAck}
            className="w-full rounded-2xl bg-lime-gradient py-4 font-bold text-primary-foreground glow-lime disabled:opacity-60"
          >
            {publishing
              ? "Publishing…"
              : !selectedAffiliation
                ? "Choose a team profile to continue"
                : !hostAck
                  ? "Acknowledge host responsibilities"
                  : "Publish game"}
          </motion.button>
          <p className="text-center text-xs text-muted-foreground pb-6">
            Hosting is free. Pro hosts get unlimited games + analytics.
          </p>
        </fieldset>
      </form>
    </div>
  );
}

function Section({
  title,
  icon,
  right,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 section-eyebrow text-muted-foreground">
        {icon}
        {title}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Toggle({
  icon,
  label,
  value,
  onChange,
  right,
}: {
  icon: React.ReactNode;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  right?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 text-sm"
    >
      <span className="flex items-center gap-2.5">
        <span className={value ? "text-lime" : "text-muted-foreground"}>{icon}</span>
        <span className="font-medium">{label}</span>
      </span>
      <span className="flex items-center gap-2">
        {right && <span className="text-xs text-muted-foreground">{right}</span>}
        <span
          className={`relative h-6 w-10 rounded-full transition-colors ${value ? "bg-lime" : "bg-secondary"}`}
        >
          <motion.span
            layout
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="absolute top-0.5 h-5 w-5 rounded-full bg-background shadow"
            style={{ left: value ? "calc(100% - 1.375rem)" : "0.125rem" }}
          />
        </span>
      </span>
    </button>
  );
}

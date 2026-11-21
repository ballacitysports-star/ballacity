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
  ChevronDown,
  Minus,
  Plus,
} from "lucide-react";
import { SPORTS, type Sport, imageFor } from "@/lib/sample-data";
import { TierChips } from "@/components/sports/TierChips";
import { addHostedGame, fetchHostedGame } from "@/lib/hosted-games-store";
import { hostAgainPrefill, planHostAgain, type HostAgainPrefill } from "@/lib/host-again";
import { SIGNUP_CUTOFF_PRESETS } from "@/lib/live-status";
import {
  ANY_SKILL,
  parseSkillTiers,
  scaleForSport,
  serializeSkillTiers,
  toggleSkillTier,
} from "@/lib/sport-levels";
import { useServerFn } from "@tanstack/react-start";
import { geocodeAddress } from "@/lib/geocode.functions";
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
import { knownErrorMessage, userErrorMessage } from "@/lib/user-error";
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
  formatWhenRange,
  normalizeSchedule,
  scheduleToPlans,
  whenRangeToPlan,
  type GamePlan,
  type ScheduleEntry,
  type WhenRange,
} from "@/lib/game-schedule";
import { AgeRequirementFields } from "@/components/games/AgeRequirementFields";
import { PublishStepDialog } from "@/components/create/PublishStepDialog";
import {
  FieldError,
  MoreOptionsToggle,
  RepeatField,
  Section,
  SpotsStepper,
  Toggle,
} from "@/components/create/CreateFormParts";
import { GamePolicyFields } from "@/components/games/GamePolicyFields";
import { GamePolicySummary } from "@/components/games/GamePolicySummary";
import {
  MAX_GAME_PLAYERS,
  MIN_GAME_PLAYERS,
  defaultGamePolicy,
  type GamePolicy,
} from "@/lib/game-policy";
import {
  MORE_OPTIONS_FIELDS,
  defaultGameTitle,
  errorCount,
  firstErrorField,
  moreOptionsChanged,
  moreOptionsSummary,
  parseSpots,
  publishSummaryLines,
  skillHint,
  validateCreateForm,
  type CreateField,
  type CreateFieldErrors,
} from "@/lib/create-form";
import { recordSafetyAck } from "@/lib/safety-acks";
import { useMyChildStatus } from "@/lib/child-safety";
import { HOSTING_BLOCKED_MESSAGE } from "@/lib/hosting-policy";
import { PreviewGate } from "@/components/public/PreviewGate";
import { trackEvent, trackTaskError } from "@/lib/analytics";
import { trackOpenCreate } from "@/lib/nav-analytics";
import { BackButton } from "@/components/layout/BackButton";
import {
  REPEAT_OPTIONS,
  repeatLabel,
  startGameSeries,
  untilError,
  type RepeatChoice,
} from "@/lib/game-series-api";
import {
  affiliationLabel as hostAffiliationLabel,
  hostAffiliations,
  preferredAffiliation,
  teamIdFor,
  type HostAffiliation,
} from "@/lib/host-affiliations";
import {
  clearCreateDraft,
  loadCreateDraft,
  saveCreateDraft,
  type CreateDraft,
} from "@/lib/create-draft";

export const Route = createFileRoute("/_tabs/create")({
  head: () =>
    pageHead({
      path: "/create",
      title: "Create a Pickup Sports Game | BallaCity",
      description: "Set up a pickup game: sport, venue, time, spots, and entry fee.",
      noindex: true,
    }),
  // `orgId` / `kind` come from a facility page's "Host a game here" action.
  // The org is looked up server-side before anything is pre-filled.
  // `again` is a finished game's id from its "Host this again" action.
  validateSearch: (
    search: Record<string, unknown>,
  ): { orgId?: string; kind?: FacilityEventKind; again?: string } => ({
    orgId: uuidParam(search.orgId),
    kind: isFacilityEventKind(search.kind) ? search.kind : undefined,
    again: uuidParam(search.again),
  }),
  component: CreateGate,
});

const uuidParam = (v: unknown): string | undefined =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v
    : undefined;

/** A signed-out visitor gets a blurred sample preview; the real page mounts only for a member. */
function CreateGate() {
  return (
    <PreviewGate tab="create">
      <Create />
    </PreviewGate>
  );
}

function Create() {
  const nav = useNavigate();
  const { orgId: orgIdParam, kind: requestedKind = "run", again: againId } = Route.useSearch();
  // P1-9: how often the Create screen is reached, to weigh a Create tab against Reels.
  useEffect(() => trackOpenCreate(requestedKind), []); // eslint-disable-line react-hooks/exhaustive-deps
  // The facility this run is hosted at: from the facility page link, or picked
  // in the "Host at a facility" selector.
  const [facilityId, setFacilityId] = useState<string | null>(orgIdParam ?? null);
  const { user } = useAuth();
  const profile = useMyProfile(user);
  const childStatus = useMyChildStatus();
  const canFeature = childStatus.can;
  const hostingDecision = canFeature("game_hosting");
  const fetchMyTeams = useServerFn(listMyTeams);
  const myTeamsQuery = useQuery({
    queryKey: ["my-teams", user?.id ?? "anon"],
    queryFn: () => fetchMyTeams(),
    enabled: !!user,
    staleTime: 30_000,
  });
  const myTeams = myTeamsQuery.data ?? [];
  type Affiliation = HostAffiliation;
  // An adult may host as themselves or under a team they own; a 16-17-year-old under a team (host-affiliations.ts; the
  // server enforces the same, 20261121100000).
  const affiliations: Affiliation[] = hostAffiliations({
    teams: myTeams,
    cohort: childStatus.status?.cohort,
    selfName: profile?.name,
  });
  const affiliationsLoading = myTeamsQuery.isLoading || (!!user && childStatus.isLoading);
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
    // Prefer the team the app is currently acting as, then the person when the app is acting as them, then the only choice.
    const preferred = preferredAffiliation(affiliations, {
      teamId: activeRefId,
      actingAsTeam: !!activeProfile && activeProfile.kind !== "player",
    });
    if (preferred) setSelectedAffiliation((cur) => cur ?? preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affiliations.length, affiliationsLoading, activeRefId]);
  const affiliationLabel = (a: Affiliation) => hostAffiliationLabel(a);
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
  // The venue starts empty and is required: no profile-city or GPS auto-fill, so a
  // game is never published at a place the host didn't choose (WP 4.2).
  const [location, setLocation] = useState("");
  // Skill options follow the picked sport's real scale (Flag / 7v7 /
  // Full contact for Football) so a game reads like a profile tier.
  const [skill, setSkill] = useState<string>(ANY_SKILL);
  const selectedSkillTiers = parseSkillTiers(sport, skill);
  const skillHintText = skillHint(scaleForSport(sport));
  useEffect(() => {
    if (skill === ANY_SKILL) return;
    const kept = serializeSkillTiers(sport, parseSkillTiers(sport, skill));
    if (kept !== skill) setSkill(kept);
  }, [sport, skill]);
  // The fee is kept as typed so clearing the box to retype it doesn't read as
  // "free" and switch the paid game off underneath the host.
  const [paid, setPaid] = useState(false);
  const [feeText, setFeeText] = useState("10");
  const price = paid ? Math.max(0, Number(feeText) || 0) : 0;
  const [indoor, setIndoor] = useState(false);
  const [priv, setPriv] = useState(false);
  const [description, setDescription] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(true);
  // Host-configurable game policy (limits, waitlist, cancellation, rules).
  const [policy, setPolicy] = useState<GamePolicy>(() => defaultGamePolicy(10));
  const size = policy.maxPlayers;
  // "Spots" in the quick form is the policy's player limit, kept as typed.
  const [spotsText, setSpotsText] = useState(() => String(defaultGamePolicy(10).maxPlayers));
  // Payment requirement + approval live in their own controls; mirror them in
  // the policy object so the preview players see matches reality.
  const effectivePolicy: GamePolicy = { ...policy, entryFee: price, requiresApproval };
  const [minAge, setMinAge] = useState<number | null>(null);
  const [maxAge, setMaxAge] = useState<number | null>(null);
  const [signupCutoffMin, setSignupCutoffMin] = useState(0);
  const [publishing, setPublishing] = useState(false);
  // Host responsibility acknowledgment, asked at the Publish step (never pre-checked, recorded per game).
  const [hostAck, setHostAck] = useState(false);
  const [publishStepOpen, setPublishStepOpen] = useState(false);
  // Everything beyond the quick form sits under "More options".
  const [moreOpen, setMoreOpen] = useState(false);
  // Problems show next to their fields once the host has tried to publish.
  const [attempted, setAttempted] = useState(false);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: CreateField; n: number } | null>(null);

  // Nudge hosts to keep their own player availability up to date.
  const hostAvailGate = useAvailabilityGate();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [positionsNeeded, setPositionsNeeded] = useState<PositionsNeeded>({});
  const [multiDay, setMultiDay] = useState(false);
  // A one-day game can repeat; the server creates the next dates (WP 3.1).
  const [repeat, setRepeat] = useState<RepeatChoice>({ freq: "none", until: null });
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);

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
    // Picking a facility is an explicit choice of venue.
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
  // An unfinished form is kept on this device and offered back on return.
  const [draftChecked, setDraftChecked] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const draftSettledRef = useRef(false);
  useEffect(() => {
    if (!user || draftSettledRef.current) return;
    draftSettledRef.current = true;
    let d: CreateDraft | null = null;
    try {
      d = loadCreateDraft(window.localStorage, user.id);
    } catch {
      d = null;
    }
    if (d) {
      if (d.sport && SPORTS.some((x) => x.name === d.sport)) {
        sportTouchedRef.current = true;
        setSport(d.sport as Sport);
      }
      if (d.title !== undefined) setTitle(d.title);
      if (d.description !== undefined) setDescription(d.description);
      if (d.skill !== undefined) setSkill(d.skill);
      if (d.paid !== undefined) setPaid(d.paid);
      if (d.feeText !== undefined) setFeeText(d.feeText);
      if (d.indoor !== undefined) setIndoor(d.indoor);
      if (d.priv !== undefined) setPriv(d.priv);
      if (d.requiresApproval !== undefined) setRequiresApproval(d.requiresApproval);
      if (d.minAge !== undefined) setMinAge(d.minAge);
      if (d.maxAge !== undefined) setMaxAge(d.maxAge);
      if (d.signupCutoffMin !== undefined) setSignupCutoffMin(d.signupCutoffMin);
      // Show a restored paid, private, age-limited or approval-off setting rather than hide it.
      if (
        moreOptionsChanged({
          paid: !!d.paid,
          price: 0,
          priv: !!d.priv,
          requiresApproval: d.requiresApproval ?? true,
          minAge: d.minAge ?? null,
          maxAge: d.maxAge ?? null,
          signupCutoffMin: d.signupCutoffMin ?? 0,
        })
      ) {
        setMoreOpen(true);
      }
      setDraftRestored(true);
    }
    setDraftChecked(true);
  }, [user]);
  // "Host this again": copy a finished game of the host's own into the form.
  // Applied once, then the id is dropped from the address so a refresh keeps
  // whatever the host has edited since. If the form already holds unfinished
  // work, the copy waits for the host's say-so instead of replacing it.
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [pendingCopy, setPendingCopy] = useState<{
    title: string;
    prefill: HostAgainPrefill;
  } | null>(null);
  const againAppliedRef = useRef<string | null>(null);
  // Dropping the id from the address re-runs the effect below, so it cannot own the cancel.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const applyCopy = (c: HostAgainPrefill, fromTitle: string) => {
    if (c.sport && SPORTS.some((x) => x.name === c.sport)) {
      sportTouchedRef.current = true;
      setSport(c.sport as Sport);
    }
    setTitle(c.title ?? "");
    setDescription(c.description ?? "");
    setSkill(c.skill ?? ANY_SKILL);
    setPaid(!!c.paid);
    if (c.feeText) setFeeText(c.feeText);
    setIndoor(!!c.indoor);
    setPriv(!!c.priv);
    // Approval stays on (the safe default) whatever the form held before.
    setRequiresApproval(c.requiresApproval ?? true);
    setMinAge(c.minAge ?? null);
    setMaxAge(c.maxAge ?? null);
    setSignupCutoffMin(c.signupCutoffMin ?? 0);
    const n = c.maxPlayers;
    if (n) {
      setPolicy((p) => ({ ...p, maxPlayers: n }));
      setSpotsText(String(n));
    }
    if (
      moreOptionsChanged({
        paid: !!c.paid,
        price: 0,
        priv: !!c.priv,
        requiresApproval: c.requiresApproval ?? true,
        minAge: c.minAge ?? null,
        maxAge: c.maxAge ?? null,
        signupCutoffMin: c.signupCutoffMin ?? 0,
      })
    ) {
      setMoreOpen(true);
    }
    setDraftRestored(false);
    setPendingCopy(null);
    setCopiedFrom(fromTitle);
  };
  // The effect below runs once per link; it reads the latest form and applier through these.
  const applyCopyRef = useRef(applyCopy);
  applyCopyRef.current = applyCopy;
  const formPlanRef = useRef<"apply" | "confirm">("apply");
  formPlanRef.current = planHostAgain({ title, description });
  useEffect(() => {
    if (!user || !draftChecked || !againId || againAppliedRef.current === againId) return;
    againAppliedRef.current = againId;
    void fetchHostedGame(againId)
      .then((g) => {
        if (!mountedRef.current) return;
        const c = g ? hostAgainPrefill(g, user.id) : null;
        if (!g || !c) {
          setCopyError("Couldn't copy that game. You can only copy a game you host.");
          return;
        }
        if (formPlanRef.current === "confirm") setPendingCopy({ title: g.title, prefill: c });
        else applyCopyRef.current(c, g.title);
      })
      .catch(() => {
        if (mountedRef.current) setCopyError("Couldn't copy that game. Try again.");
      });
    void nav({ to: "/create", search: (prev) => ({ ...prev, again: undefined }), replace: true });
  }, [user, draftChecked, againId, nav]);
  const publishedRef = useRef(false);
  useEffect(() => {
    if (!user || !draftChecked) return;
    const t = window.setTimeout(() => {
      if (publishedRef.current) return;
      try {
        saveCreateDraft(window.localStorage, user.id, {
          sport,
          title,
          description,
          skill,
          paid,
          feeText,
          indoor,
          priv,
          requiresApproval,
          minAge,
          maxAge,
          signupCutoffMin,
        });
      } catch {
        /* storage unavailable */
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [
    user,
    draftChecked,
    sport,
    title,
    description,
    skill,
    paid,
    feeText,
    indoor,
    priv,
    requiresApproval,
    minAge,
    maxAge,
    signupCutoffMin,
  ]);
  const discardDraft = () => {
    setTitle("");
    setDescription("");
    setSkill(ANY_SKILL);
    setPaid(false);
    setFeeText("10");
    setIndoor(false);
    setPriv(false);
    setRequiresApproval(true);
    setMinAge(null);
    setMaxAge(null);
    setSignupCutoffMin(0);
    setDraftRestored(false);
    try {
      if (user) clearCreateDraft(window.localStorage, user.id);
    } catch {
      /* ignore */
    }
  };

  const handleLocationChange = (next: string) => {
    setLocation(next);
    // Typing invalidates any previously picked venue coordinates; we re-resolve
    // them from the address on publish so distance is always real.
    setCoords(null);
  };

  const formErrors = (): CreateFieldErrors =>
    validateCreateForm({
      hasAffiliation: !!selectedAffiliation,
      multiDay,
      when,
      schedule,
      repeat,
      location,
      profileCity: profile?.city ?? null,
      spotsText,
      paid,
      feeText,
      policy: effectivePolicy,
      timeZone: eventTimeZone,
    });
  // Recomputed on every change once the host has tried, so a fixed field clears at once.
  const fieldErrors: CreateFieldErrors = attempted ? formErrors() : {};
  const problemCount = errorCount(fieldErrors);
  const moreOptionsProblem = Array.from(MORE_OPTIONS_FIELDS).some((f) => !!fieldErrors[f]);

  const showProblems = (errors: CreateFieldErrors) => {
    setAttempted(true);
    const first = firstErrorField(errors);
    if (!first) return false;
    if (MORE_OPTIONS_FIELDS.has(first)) setMoreOpen(true);
    setFocusRequest({ field: first, n: Date.now() });
    return true;
  };
  // Focus the first field with a problem once it is on screen (More options may have just opened).
  useEffect(() => {
    if (!focusRequest) return;
    const el = document.getElementById(FIELD_DOM_ID[focusRequest.field]);
    if (!el) return;
    // A group with tabIndex -1 (When) takes focus itself, so its error is read with it.
    const target =
      el.matches("input, select, textarea, button") || el.getAttribute("tabindex") === "-1"
        ? el
        : (el.querySelector<HTMLElement>(
            "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])",
          ) ??
          el.querySelector<HTMLElement>("button:not([disabled])") ??
          el);
    target.scrollIntoView?.({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }, [focusRequest]);

  const spotsValue = parseSpots(spotsText) ?? size;
  const setSpots = (text: string) => {
    setSpotsText(text);
    const n = parseSpots(text);
    if (n != null) setPolicy((p) => ({ ...p, maxPlayers: n }));
  };
  // Step 1 (the form's button): check every field, then open the Publish step.
  const reviewBeforePublish = () => {
    if (publishing) return;
    if (!user) {
      toast.error("Sign in to host a game");
      nav({ to: "/auth", search: { next: "/create" } });
      return;
    }
    if (facilityId && orgContextQuery.isLoading) {
      setFormNotice("Still loading the facility details. Try again in a moment.");
      return;
    }
    setFormNotice(null);
    if (showProblems(formErrors())) return;
    setHostAck(false);
    setPublishStepOpen(true);
  };

  const closePublishStep = (open: boolean) => {
    if (open || publishing) return;
    setPublishStepOpen(false);
    // Asked again on every Publish step.
    setHostAck(false);
  };

  // Step 2 (the Publish step's button): publish, only with the acknowledgment ticked.
  const publish = async () => {
    if (publishing || !user) return;
    if (!hostAck) return;
    // Checked again: time may have moved a start into the past while the step was open.
    const errors = formErrors();
    if (firstErrorField(errors) || !selectedAffiliation) {
      setPublishStepOpen(false);
      setHostAck(false);
      showProblems(errors);
      return;
    }
    setPublishing(true);

    let createdCount = 0;
    let totalPlans = 0;
    let firstGameId: string | null = null;
    try {
      // Compute one or many start times, each with its own length (already checked above).
      const plans: GamePlan[] = multiDay
        ? scheduleToPlans(schedule, eventTimeZone)
        : [whenRangeToPlan(when, eventTimeZone)];
      totalPlans = plans.length;

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
          return data;
        },
      });

      // Resolve venue coordinates: prefer what the autocomplete gave us,
      // otherwise geocode the typed address. Missing geo is not fatal —
      // the game just won't show a distance until it's geocoded.
      let venue = coords;
      if (!venue) {
        try {
          const res = await geocode({ data: { address: location.trim() } });
          venue = { lat: res.lat, lng: res.lng };
          setCoords(venue);
        } catch {
          venue = null;
        }
        if (!venue) {
          toast.warning("We couldn't place that address on the map", {
            description:
              "The game will publish, but players won't see a distance. Pick the venue from the search suggestions to pin it.",
          });
        }
      }

      const cleanPositions = positionsCleanup(positionsNeeded);
      // One shared series id links all sessions of a multi-day event so
      // the feed renders a single card instead of one card per day.
      const seriesId = plans.length > 1 ? crypto.randomUUID() : undefined;
      for (const plan of plans) {
        const game = await addHostedGame({
          sport,
          title: title.trim() || defaultGameTitle(sport),
          date: plan.startIso,
          duration: durationToText(plan.durationMin),
          location: location.trim(),
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
          teamId: teamIdFor(selectedAffiliation),
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
          cancelCutoffMin: effectivePolicy.cancelCutoffMin,
          gameRules: effectivePolicy.gameRules || null,
        });

        createdCount += 1;
        if (!firstGameId) firstGameId = game.id;

        // Record the host's responsibility acknowledgment for this game.
        void recordSafetyAck({ gameId: game.id, kind: "host_responsibility" }).catch(() => {});

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
        } catch (err) {
          toast.error(
            userErrorMessage(
              err,
              "Your game was saved, but its approval and fee settings weren't. Check them on the game page.",
            ),
          );
        }
      }

      // Note: do NOT auto-join the host. Hosting ≠ playing; the host
      // sees their published games in the profile's hosted section.
      trackEvent("create_game", { count: plans.length });
      publishedRef.current = true;
      try {
        clearCreateDraft(window.localStorage, user.id);
      } catch {
        /* ignore */
      }
      // A one-day game set to repeat: the server makes it a series and creates the next dates. The game is already
      // published, so a failure here only leaves it as a single game.
      let repeatNote = "";
      if (!multiDay && plans.length === 1 && repeat.freq !== "none" && firstGameId) {
        try {
          const started = await startGameSeries(firstGameId, repeat);
          repeatNote = ` · ${repeatLabel({ freq: repeat.freq, until: repeat.until })?.toLowerCase()}${
            started.created > 0
              ? ` (${started.created} more ${started.created === 1 ? "date" : "dates"} added)`
              : ""
          }`;
        } catch (err) {
          toast.error(
            `Game published, but it couldn't be set to repeat. ${userErrorMessage(
              err,
              "It was published as a single game.",
            )}`,
          );
        }
      }
      toast.success(
        plans.length > 1 ? `Created ${plans.length} games` : `Game published${repeatNote}`,
      );
      // A series opens on its first date, not back on the feed, so the host sees it exist.
      nav({ to: "/games/$gameId", params: { gameId: firstGameId! }, replace: true });
    } catch (err) {
      if (createdCount > 0 && firstGameId) {
        // Some dates are already live; trying again would duplicate them, so no retry advice here: only a
        // catalog sentence for why the rest failed, when there is one.
        const why = knownErrorMessage(err);
        toast.error(
          `Only ${createdCount} of ${totalPlans} games were published.${why ? ` ${why}` : ""} Check your hosted games before trying again.`,
        );
        nav({ to: "/games/$gameId", params: { gameId: firstGameId } });
      } else {
        trackTaskError("publish_game");
        toast.error(`Couldn't publish your game. ${userErrorMessage(err, "Please try again.")}`);
      }
    } finally {
      setPublishing(false);
    }
  };

  if (!user) {
    return (
      <div className="page-shell-content pt-6">
        <div className="flex items-center gap-3 mb-5">
          <Link
            to="/feed"
            aria-label="Back to feed"
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
            search={{ next: "/create" }}
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
            aria-label="Back to feed"
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

  // Gate: someone who may host but is not an adult (16-17) hosts under a team profile.

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
            aria-label="Back to feed"
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
              Under 18, games are published under a team profile so players know who they're
              joining. Add a team profile to your account to start hosting — your other profiles
              stay as they are.
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
        <BackButton
          fallbackTo={orgIdParam ? `/orgs/${orgIdParam}` : "/feed"}
          label={orgIdParam ? "Back to facility" : "Back"}
          className="border border-border bg-surface"
        />
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
                : `Community game at ${postingOrg.name}`}
            </div>
            <div className="text-muted-foreground">
              {priv && !postingOfficial
                ? "Private games aren't listed on the facility page. Make it public to list it there."
                : `Your game will be listed on ${postingOrg.name}'s page. The venue is filled in — you can still change any detail below.`}
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
            Fills in the address and map pin, and lists the game on the facility&apos;s page.
          </span>
        </label>
      )}

      {!hostAvailGate.loading && !hostAvailGate.hasOpenAvailability && (
        <AvailabilityPromptBanner className="mb-4" />
      )}

      {copyError && (
        <div
          role="alert"
          className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs font-semibold text-destructive"
        >
          {copyError}
        </div>
      )}

      {pendingCopy && (
        <div
          role="alert"
          className="mb-4 space-y-2 rounded-2xl border border-border bg-surface px-4 py-3 text-xs"
        >
          <p className="text-muted-foreground">
            You have an unfinished game here. Replace it with a copy of “{pendingCopy.title}”?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => applyCopy(pendingCopy.prefill, pendingCopy.title)}
              className="rounded-full bg-background px-3 py-1.5 font-bold"
            >
              Replace it
            </button>
            <button
              type="button"
              onClick={() => setPendingCopy(null)}
              className="rounded-full border border-border px-3 py-1.5 font-semibold"
            >
              Keep mine
            </button>
          </div>
        </div>
      )}

      {copiedFrom && (
        <div
          role="status"
          className="mb-4 rounded-2xl border border-border bg-surface px-4 py-3 text-xs text-muted-foreground"
        >
          Copied from “{copiedFrom}”. Pick the date and venue, check the rest, then publish. Players
          still need your approval to join unless you change that under More options.
        </div>
      )}

      {draftRestored && (
        <div
          role="status"
          className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-xs"
        >
          <span className="text-muted-foreground">
            We kept your unfinished game. Set the date and venue, then publish.
          </span>
          <button type="button" onClick={discardDraft} className="shrink-0 font-semibold underline">
            Start over
          </button>
        </div>
      )}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          reviewBeforePublish();
        }}
        className="space-y-5"
      >
        {/* Host as (team/club) */}
        <div
          id={FIELD_DOM_ID.hostAs}
          ref={hostAsRef}
          className={`rounded-2xl ${
            (!selectedAffiliation && affiliations.length > 1) || fieldErrors.hostAs
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
                <div
                  role="group"
                  aria-label="Host as"
                  aria-describedby={fieldErrors.hostAs ? "create-host-as-error" : undefined}
                  className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1"
                >
                  {affiliations.map((a) => {
                    const active =
                      selectedAffiliation?.source === a.source && selectedAffiliation.id === a.id;
                    return (
                      <button
                        type="button"
                        key={`${a.source}:${a.id}`}
                        aria-pressed={active}
                        onClick={() => setSelectedAffiliation(a)}
                        className={`shrink-0 flex min-h-11 items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold ${
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
                {fieldErrors.hostAs ? (
                  <FieldError id="create-host-as-error" message={fieldErrors.hostAs} />
                ) : (
                  !selectedAffiliation && (
                    <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                      Pick who you're hosting as to continue.
                    </p>
                  )
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
          {/* ---------- Quick form: sport, when, where, spots, repeat ---------- */}
          <Section title="Sport">
            <div className="grid grid-cols-3 gap-2">
              {SPORTS.map((s) => {
                const active = sport === s.name;
                return (
                  <button
                    type="button"
                    key={s.name}
                    aria-pressed={active}
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
                    <span className="text-2xl" aria-hidden>
                      {s.emoji}
                    </span>
                    <span>{s.name}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* When */}
          <div
            id={FIELD_DOM_ID.when}
            tabIndex={-1}
            role="group"
            aria-label="When"
            aria-describedby={fieldErrors.when ? "create-when-error" : undefined}
          >
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
                <>
                  <GameScheduleBuilder value={schedule} onChange={setSchedule} />
                  {fieldErrors.when && (
                    <FieldError id="create-when-error" message={fieldErrors.when} />
                  )}
                </>
              ) : (
                <>
                  <DateTimeRangePicker
                    value={when}
                    onChange={setWhen}
                    todayKey={todayKeyInZone(eventTimeZone)}
                    timeZoneLabel={`${timeZoneAbbr(new Date(), eventTimeZone)} · ${eventTimeZone.split("/").pop()?.replace(/_/g, " ")}`}
                  />
                  {/* The picker already shows this problem under its fields; this copy names it for screen readers. */}
                  {fieldErrors.when && (
                    <FieldError id="create-when-error" message={fieldErrors.when} srOnly />
                  )}
                  <RepeatField
                    untilId={FIELD_DOM_ID.repeatUntil}
                    value={repeat}
                    onChange={setRepeat}
                    firstDate={when.startDate}
                    untilError={fieldErrors.repeatUntil}
                  />
                </>
              )}
            </Section>
          </div>

          {/* Where: a real venue is required to publish */}
          <Section title="Where" icon={<MapPin className="h-4 w-4" />}>
            <LocationAutocomplete
              inputId={FIELD_DOM_ID.venue}
              ariaLabel="Venue"
              ariaInvalid={!!fieldErrors.venue}
              ariaDescribedBy={
                fieldErrors.venue ? "create-venue-hint create-venue-error" : "create-venue-hint"
              }
              value={location}
              onChange={handleLocationChange}
              onPick={(_v, _placeId, geo) => {
                if (geo) setCoords({ lat: geo.lat, lng: geo.lng });
              }}
              placeholder="Search court, park or venue"
            />
            {fieldErrors.venue && (
              <FieldError id="create-venue-error" message={fieldErrors.venue} />
            )}
            <p id="create-venue-hint" className="px-1 text-[11px] text-muted-foreground">
              Required. Pick the court, park or venue from the suggestions so players see the
              distance.
            </p>
          </Section>

          {/* Spots: the player limit */}
          <Section title="Spots" icon={<Users className="h-4 w-4" />}>
            <SpotsStepper
              id={FIELD_DOM_ID.spots}
              text={spotsText}
              value={spotsValue}
              onTextChange={setSpots}
              error={fieldErrors.spots}
            />
          </Section>

          {/* ---------- More options: every other field, with its usual default ---------- */}
          <MoreOptionsToggle
            open={moreOpen}
            onToggle={() => setMoreOpen((o) => !o)}
            controls="create-more-options"
            summary={moreOptionsSummary({
              paid,
              price,
              priv,
              requiresApproval,
              minAge,
              maxAge,
              signupCutoffMin,
            })}
            hasProblem={moreOptionsProblem}
          />

          <div id="create-more-options" hidden={!moreOpen} className="space-y-5">
            {/* Title */}
            <Section title="Game title (optional)">
              <input
                id="create-title"
                aria-label="Game title"
                aria-describedby="create-title-hint"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Friday Night 5v5 · Full Court"
                className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
              />
              <p id="create-title-hint" className="px-1 text-[11px] text-muted-foreground">
                Leave blank to use “{defaultGameTitle(sport)}”.
              </p>
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
              {skillHintText && (
                <p className="mt-2 px-1 text-[11px] text-muted-foreground">{skillHintText}</p>
              )}
            </Section>

            {/* Positions needed */}
            <Section title="Positions needed">
              <PositionsPicker
                sport={sport}
                value={positionsNeeded}
                onChange={setPositionsNeeded}
              />
            </Section>

            {/* Toggles */}
            <Section title="Details">
              <div
                className={`rounded-2xl border bg-surface px-4 py-3 ${
                  fieldErrors.fee ? "border-destructive" : "border-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2.5 text-sm">
                    <DollarSign
                      className={`h-4 w-4 ${paid ? "text-lime" : "text-muted-foreground"}`}
                    />
                    <span className="font-medium">Paid game</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={paid}
                    onClick={() => setPaid(!paid)}
                    className={`relative h-6 w-10 rounded-full transition-colors ${paid ? "bg-lime" : "bg-secondary"}`}
                    aria-label="Paid game"
                  >
                    <motion.span
                      layout
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="absolute top-0.5 h-5 w-5 rounded-full bg-background shadow"
                      style={{ left: paid ? "calc(100% - 1.375rem)" : "0.125rem" }}
                    />
                  </button>
                </div>
                {paid && (
                  <>
                    <div className="mt-3 flex items-center gap-2">
                      <span className="section-eyebrow text-muted-foreground">Entry fee</span>
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                          $
                        </span>
                        <input
                          id={FIELD_DOM_ID.fee}
                          type="number"
                          inputMode="decimal"
                          aria-label="Entry fee in dollars"
                          aria-invalid={fieldErrors.fee ? true : undefined}
                          aria-describedby={fieldErrors.fee ? "create-fee-error" : undefined}
                          step="0.01"
                          value={feeText}
                          onChange={(e) => setFeeText(e.target.value)}
                          className={`w-full rounded-xl border bg-background pl-7 pr-3 py-2 text-sm outline-none focus:border-lime ${
                            fieldErrors.fee ? "border-destructive" : "border-border"
                          }`}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">per player</span>
                    </div>
                    {fieldErrors.fee && (
                      <FieldError id="create-fee-error" message={fieldErrors.fee} />
                    )}
                  </>
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
              {priv && (
                <p className="px-1 text-[11px] text-muted-foreground">
                  Only people you invite can see this game. To invite someone, open a player&apos;s
                  availability card on the Players tab and tap Invite.
                </p>
              )}
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
                  New signups close automatically this long before start. The game then shows
                  "Signup closed", and "In progress" once it starts.
                </p>
              </div>
            </Section>

            {/* Game policy (the player limit is "Spots" above) */}
            <Section title="Game policy" icon={<Users className="h-4 w-4" />}>
              <GamePolicyFields
                value={effectivePolicy}
                onChange={setPolicy}
                idPrefix="create-policy"
                showPlayerLimit={false}
                errors={{
                  minPlayers: fieldErrors.minPlayers,
                  cancellationNotes: fieldErrors.cancellationNotes,
                }}
              />
            </Section>

            {/* What players will see */}
            <Section title="What players see before joining">
              <GamePolicySummary policy={effectivePolicy} defaultOpen />
            </Section>

            {/* Description */}
            <Section title="Description">
              <textarea
                aria-label="Description"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Format, vibe, what to bring..."
                className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime resize-none"
              />
            </Section>
          </div>

          {formNotice && (
            <p
              role="alert"
              className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs font-semibold text-destructive"
            >
              {formNotice}
            </p>
          )}
          {problemCount > 0 && (
            // Polite: the count drops as each field is fixed while typing, and focus is already on the first problem.
            <p
              role="status"
              id="create-form-error"
              className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs font-semibold text-destructive"
            >
              {fieldErrors.form ??
                `Fix ${problemCount === 1 ? "the problem" : `the ${problemCount} problems`} marked above to publish.`}
            </p>
          )}

          <motion.button
            id={FIELD_DOM_ID.form}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={publishing || !selectedAffiliation}
            className="w-full rounded-2xl bg-lime-gradient py-4 font-bold text-primary-foreground glow-lime disabled:opacity-60"
          >
            {publishing
              ? "Publishing…"
              : !selectedAffiliation
                ? "Choose who you're hosting as"
                : "Review and publish"}
          </motion.button>
          <p className="text-center text-xs text-muted-foreground pb-6">
            Hosting is free. You&apos;ll confirm your host responsibilities before it goes live.
          </p>
        </fieldset>
      </form>

      <PublishStepDialog
        open={publishStepOpen}
        onOpenChange={closePublishStep}
        // Built whether or not the step is open, so it doesn't empty while the dialog fades out.
        summary={publishSummaryLines({
          title,
          sport,
          multiDay,
          when,
          schedule,
          repeat,
          location,
          spots: size,
          requiresApproval,
          priv,
          paid,
          price,
        })}
        accepted={hostAck}
        onAcceptedChange={setHostAck}
        publishing={publishing}
        onPublish={() => void publish()}
      />
    </div>
  );
}

/** The element each field's problem focuses (an input, or a group whose first control gets focus). */
const FIELD_DOM_ID: Record<CreateField, string> = {
  hostAs: "create-host-as",
  when: "create-when",
  repeatUntil: "create-repeat-until",
  venue: "create-venue",
  spots: "create-spots",
  fee: "create-fee",
  minPlayers: "create-policy-min-players",
  cancellationNotes: "create-policy-cancel-notes",
  form: "create-publish",
};

import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Sparkles, X, Plus, MapPin } from "lucide-react";
import { SPORTS, HERO_IMAGE, type Sport, type Org } from "@/lib/sample-data";
import { addOrg } from "@/lib/org-store";
import { SESSION_TYPES } from "@/lib/sport-config";
import { AgeGroupPicker } from "@/components/AgeGroupPicker";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { VenueMapPreview } from "@/components/VenueMapPreview";
import { OrgCard } from "@/components/OrgCard";
import { ImageUploader } from "@/components/ImageUploader";
import { useAuth } from "@/hooks/use-auth";
import { useUserLocation } from "@/lib/geo";

import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { AvailabilityRulesEditor } from "@/components/AvailabilityRulesEditor";
import type { AvailabilityRule } from "@/lib/availability-resolve";
import { loadDraft, useDraftPersistence } from "@/components/create/useDraftPersistence";
import { SaveStatus } from "@/components/SaveStatus";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listTrainerOrgs,
  createTrainerOrg,
  requestToJoinTrainerOrg,
} from "@/lib/trainer-orgs.functions";
import { autocompletePlaces, getPlaceDetails } from "@/lib/places.functions";
import { toast } from "sonner";
import { setActiveProfileByRef, myProfilesKey } from "@/lib/account-profiles";

const STEP_LABELS = ["Basics", "Expertise", "Where", "Availability"] as const;
const SKILL_LABELS = ["Beginner", "Recreational", "Intermediate", "Advanced", "Pro"] as const;

type Slot = {
  day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  start: string;
  end: string;
  venue?: string;
};

type VenueEntry = {
  address: string;
  placeId: string;
  geo: { lat: number; lng: number } | null;
};

type Draft = {
  step: number;
  name: string;
  handle: string;
  handleTouched: boolean;
  primarySport: Sport | null;
  extraSports: Sport[];
  city: string;
  tagline: string;
  bio: string;
  rate: number;
  skillMin: number;
  skillMax: number;
  sessionTypes: string[];
  ageGroups: string[];
  credentials: string[];
  venues: VenueEntry[];
  primaryVenueIdx: number;
  slots: Slot[];
  overrides: {
    date: string;
    closed?: boolean;
    windows?: { start: string; end: string; venue?: string }[];
  }[];
  rules: AvailabilityRule[];
  timezone: string;
  orgChoice: {
    mode: "existing" | "new" | null;
    orgId?: string;
    name?: string;
    address?: string;
    placeId?: string;
    geo?: { lat: number; lng: number } | null;
  };

  avatarUrl: string | null;
  coverUrl: string | null;
};

const DRAFT_KEY = "openrun.trainer-wizard.draft.v1";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function slugifyHandle(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "")
    .slice(0, 20);
}

function defaultTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

function initialDraft(): Draft {
  return {
    step: 0,
    name: "",
    handle: "",
    handleTouched: false,
    primarySport: null,
    extraSports: [],
    city: "",
    tagline: "",
    bio: "",
    rate: 75,
    skillMin: 1,
    skillMax: 3,
    sessionTypes: [],
    ageGroups: [],
    credentials: [],
    venues: [],
    primaryVenueIdx: 0,

    slots: [],
    overrides: [],
    rules: [],
    timezone: defaultTimezone(),
    orgChoice: { mode: null },
    avatarUrl: null,
    coverUrl: null,
  };
}

export function CreateTrainerWizard() {
  const nav = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [draft, setDraft] = useState<Draft>(() => {
    if (typeof window === "undefined") return initialDraft();
    const stored = loadDraft<
      Draft & {
        venue?: string;
        venuePlaceId?: string;
        venueGeo?: { lat: number; lng: number } | null;
      }
    >(DRAFT_KEY);
    if (!stored) return initialDraft();
    // Migrate legacy single-venue drafts into the new venues[] shape.
    let venues: VenueEntry[] = Array.isArray(stored.venues) ? stored.venues : [];
    if (venues.length === 0 && stored.venue) {
      venues = [
        { address: stored.venue, placeId: stored.venuePlaceId ?? "", geo: stored.venueGeo ?? null },
      ];
    }
    return { ...initialDraft(), ...stored, venues, primaryVenueIdx: stored.primaryVenueIdx ?? 0 };
  });

  const [credInput, setCredInput] = useState("");
  const [venueInput, setVenueInput] = useState("");
  const [orgSearch, setOrgSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const { clear: clearDraft, ...draftStatus } = useDraftPersistence(DRAFT_KEY, draft);

  const listOrgs = useServerFn(listTrainerOrgs);
  const createOrg = useServerFn(createTrainerOrg);
  const joinOrg = useServerFn(requestToJoinTrainerOrg);
  const placesAutocomplete = useServerFn(autocompletePlaces);
  const placesDetails = useServerFn(getPlaceDetails);
  const orgResults = useQuery({
    queryKey: ["trainer-orgs-search", orgSearch],
    queryFn: () => listOrgs({ data: { search: orgSearch } }),
    enabled: orgSearch.trim().length >= 2,
    staleTime: 15_000,
  });

  // Debounced Google Places lookup for real-world gyms/academies, biased to the user's location.
  const { coords: userCoords, status: geoStatus, request: requestUserLocation } = useUserLocation();
  const [orgSearchDebounced, setOrgSearchDebounced] = useState("");
  const [placesSessionToken, setPlacesSessionToken] = useState<string>(() =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2),
  );
  useEffect(() => {
    const t = window.setTimeout(() => setOrgSearchDebounced(orgSearch.trim()), 250);
    return () => window.clearTimeout(t);
  }, [orgSearch]);
  // Ask for location once the user actually starts typing a gym name.
  useEffect(() => {
    if (orgSearchDebounced.length >= 2 && geoStatus === "idle") requestUserLocation();
  }, [orgSearchDebounced, geoStatus, requestUserLocation]);
  const placesResults = useQuery({
    queryKey: [
      "trainer-orgs-places",
      orgSearchDebounced,
      placesSessionToken,
      userCoords?.lat ?? null,
      userCoords?.lng ?? null,
    ],
    queryFn: () =>
      placesAutocomplete({
        data: {
          input: orgSearchDebounced,
          sessionToken: placesSessionToken,
          lat: userCoords?.lat ?? null,
          lng: userCoords?.lng ?? null,
        },
      }),
    enabled: orgSearchDebounced.length >= 2,
    staleTime: 30_000,
  });

  const pickPlaceAsNewOrg = async (id: string, primary: string, secondary: string) => {
    const optimisticAddress = secondary ? `${primary}, ${secondary}` : primary;
    setDraft((d) => ({
      ...d,
      orgChoice: {
        mode: "new",
        name: primary,
        address: optimisticAddress,
        placeId: id,
        geo: null,
      },
    }));
    const tokenAtPick = placesSessionToken;
    setPlacesSessionToken(
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    );
    try {
      const details = await placesDetails({ data: { placeId: id, sessionToken: tokenAtPick } });
      setDraft((d) => ({
        ...d,
        orgChoice: {
          ...d.orgChoice,
          mode: "new",
          name: primary,
          address: details.formattedAddress || optimisticAddress,
          placeId: id,
          geo: { lat: details.lat, lng: details.lng },
        },
      }));
    } catch (err) {
      console.error("[trainer-wizard] place details failed", err);
    }
  };

  useEffect(() => {
    const stored = loadDraft<Draft>(DRAFT_KEY);
    if (stored && (stored.name || stored.bio || (stored.venues && stored.venues.length > 0))) {
      setRestored(true);
    }
  }, []);

  // Auto-suggest handle from name until the user edits it directly.
  useEffect(() => {
    if (draft.handleTouched) return;
    const slug = slugifyHandle(draft.name);
    if (slug && slug !== draft.handle) {
      setDraft((d) => ({ ...d, handle: slug }));
    }
  }, [draft.name, draft.handleTouched, draft.handle]);

  const step = draft.step;
  const setStep = (n: number) => setDraft((d) => ({ ...d, step: n }));

  const sports = useMemo(
    () =>
      draft.primarySport
        ? [draft.primarySport, ...draft.extraSports.filter((s) => s !== draft.primarySport)]
        : [],
    [draft.primarySport, draft.extraSports],
  );

  const bioOk = draft.bio.trim().length >= 40;
  const verifiedVenues = useMemo(
    () => draft.venues.filter((v) => v.address.trim() && v.placeId),
    [draft.venues],
  );
  const primaryVenue: VenueEntry | null =
    verifiedVenues[Math.min(draft.primaryVenueIdx, Math.max(verifiedVenues.length - 1, 0))] ??
    verifiedVenues[0] ??
    null;
  const verifiedVenueAddresses = verifiedVenues.map((v) => v.address);
  const venueOk = verifiedVenues.length > 0;

  const canNext = useMemo(() => {
    if (step === 0)
      return (
        draft.name.trim().length > 1 &&
        draft.handle.trim().length > 1 &&
        !!draft.primarySport &&
        draft.city.trim().length > 0
      );
    if (step === 1) return bioOk;
    if (step === 2) return venueOk;
    return true;
  }, [step, draft, bioOk, venueOk]);

  const canSkip = step === 1 || step === 3;

  const previewOrg: Org = {
    id: "preview",
    kind: "coach",
    name: draft.name || "Your trainer profile",
    handle: draft.handle.startsWith("@") ? draft.handle : `@${draft.handle || "handle"}`,
    tagline:
      draft.tagline ||
      (draft.primarySport ? `${draft.primarySport} trainer` : "Add a short tagline"),
    city: draft.city || "Your city",
    founded: new Date().getFullYear(),
    sports: sports.length ? sports : (["Basketball"] as Sport[]),
    verified: false,
    cover: draft.coverUrl ?? HERO_IMAGE,
    avatar: draft.avatarUrl ?? initials(draft.name || "OR"),
    avatarUrl: draft.avatarUrl ?? undefined,
    avatarInitials: initials(draft.name || "OR"),
    accent: "#a3ff12",
    followers: 0,
    roster: 0,
    bio: draft.bio,
    achievements: [],
    credentials: draft.credentials,
    ratePerHour: draft.rate,
    skillRange: { min: draft.skillMin, max: draft.skillMax },
    sessionTypes: draft.sessionTypes,
    ageGroups: draft.ageGroups,
    venueAddresses: verifiedVenueAddresses,
    verifiedVenues: verifiedVenueAddresses.map((a) => a.toLowerCase()),
    venueGeo: verifiedVenues
      .filter((v) => v.geo)
      .map((v) => ({ address: v.address, placeId: v.placeId, lat: v.geo!.lat, lng: v.geo!.lng })),
    primaryVenue: primaryVenue?.address,

    availabilitySlots: draft.slots,
    availabilityOverrides: draft.overrides,
    availabilityRules: draft.rules,
    timezone: draft.timezone,
    upcoming: [],
    posts: [],
  };

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const id = `c-${(draft.name || "trainer").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36).slice(-4)}`;
    const handleClean = draft.handle
      .replace(/^@/, "")
      .replace(/[^a-z0-9_]/gi, "")
      .toLowerCase();
    const org: Org = {
      ...previewOrg,
      id,
      handle: `@${handleClean || "trainer"}`,
    };
    try {
      const saved = await addOrg(org);
      // Best-effort org linking; never blocks publish success.
      if (draft.orgChoice.mode === "existing" && draft.orgChoice.orgId) {
        try {
          await joinOrg({ data: { orgId: draft.orgChoice.orgId, trainerId: saved.id } });
        } catch {
          toast.message(
            "Profile published — couldn't send org join request. Try again from your profile.",
          );
        }
      } else if (draft.orgChoice.mode === "new" && draft.orgChoice.name) {
        try {
          const orgHandle =
            slugifyHandle(draft.orgChoice.name) || `org${Date.now().toString(36).slice(-4)}`;
          await createOrg({
            data: {
              name: draft.orgChoice.name,
              handle: orgHandle,
              trainerId: saved.id,
              city: draft.city || undefined,
              address: draft.orgChoice.address?.trim() || undefined,
              placeId: draft.orgChoice.placeId || undefined,
              geo: draft.orgChoice.geo ?? undefined,
            },
          });
        } catch {
          toast.message("Profile published — couldn't create the org. Add it from your profile.");
        }
      }
      await setActiveProfileByRef("trainer", saved.id).catch(() => {});
      await qc.invalidateQueries({ queryKey: myProfilesKey(user?.id), refetchType: "all" });
      clearDraft();
      toast.success("Trainer profile published");
      nav({ to: "/trainers/$trainerId", params: { trainerId: saved.id } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create trainer profile.";
      setSubmitError(/unauthor/i.test(msg) ? "Please sign in to create a trainer profile." : msg);
      setSubmitting(false);
    }
  }

  function addCred() {
    const v = credInput.trim();
    if (!v) return;
    setDraft((d) => ({ ...d, credentials: [...d.credentials, v] }));
    setCredInput("");
  }

  return (
    <div className="page-shell-narrow pt-6 pb-32">
      <div className="flex items-center gap-3 mb-4">
        <Link
          to="/trainers"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="micro-label text-muted-foreground font-bold">
            Step {step + 1} of {STEP_LABELS.length} · {STEP_LABELS[step]}
          </div>
          <h1 className="font-display text-xl font-bold leading-tight">
            {step === 0 && "The basics"}
            {step === 1 && "Your expertise"}
            {step === 2 && "Where you train"}
            {step === 3 && "When you're available"}
          </h1>
          <SaveStatus {...draftStatus} savedLabel="Draft saved" className="mt-0.5" />
        </div>
      </div>

      <div className="flex gap-1.5 mb-4">
        {STEP_LABELS.map((_, i) => (
          <div key={i} className="h-1 flex-1 rounded-full overflow-hidden bg-secondary">
            <motion.div
              initial={false}
              animate={{ width: i <= step ? "100%" : "0%" }}
              transition={{ duration: 0.35 }}
              className="h-full bg-lime-gradient"
            />
          </div>
        ))}
      </div>

      {restored && (
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-lime/30 bg-lime/5 px-3 py-2 text-[12px]">
          <span className="text-lime font-semibold">Draft restored</span>
          <button
            type="button"
            onClick={() => {
              clearDraft();
              setDraft(initialDraft());
              setRestored(false);
            }}
            className="text-muted-foreground hover:text-coral text-[11px] font-semibold"
          >
            Start over
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.22 }}
        >
          {step === 0 && (
            <div className="space-y-5">
              <Section title="Your name">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Jordan Kim"
                  className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                />
              </Section>

              <Section title="Handle" hint="Auto-suggested from your name. Tap to customize.">
                <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 focus-within:border-lime">
                  <span className="text-muted-foreground">@</span>
                  <input
                    value={draft.handle.replace(/^@/, "")}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        handle: e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase(),
                        handleTouched: true,
                      }))
                    }
                    placeholder="yourhandle"
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </Section>

              <Section title="Primary sport" hint="You can add more later.">
                <div className="grid grid-cols-3 gap-2">
                  {SPORTS.map((s) => {
                    const active = draft.primarySport === s.name;
                    return (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, primarySport: s.name }))}
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

              <Section title="City">
                <LocationAutocomplete
                  value={draft.city}
                  onChange={(v) => setDraft((d) => ({ ...d, city: v }))}
                  placeholder="Brooklyn, NY"
                  mode="city"
                />
              </Section>

              <Section title="Tagline (optional)">
                <input
                  value={draft.tagline}
                  onChange={(e) => setDraft((d) => ({ ...d, tagline: e.target.value }))}
                  maxLength={80}
                  placeholder="One line that sums you up"
                  className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                />
              </Section>

              <Section title="Profile photo (optional)">
                <ImageUploader
                  kind="avatar"
                  bucket="trainer-avatars"
                  pathPrefix={user?.id}
                  value={draft.avatarUrl ?? ""}
                  onChange={(url) => setDraft((d) => ({ ...d, avatarUrl: url }))}
                  onClear={() => setDraft((d) => ({ ...d, avatarUrl: null }))}
                />
              </Section>

              <Section title="Cover image (optional)">
                <ImageUploader
                  kind="cover"
                  bannerPreview
                  bucket="team-covers"
                  pathPrefix={user?.id}
                  value={draft.coverUrl ?? ""}
                  fallback={HERO_IMAGE}
                  onChange={(url) => setDraft((d) => ({ ...d, coverUrl: url }))}
                  onClear={() => setDraft((d) => ({ ...d, coverUrl: null }))}
                  presets={draft.primarySport ? [draft.primarySport] : undefined}
                />
              </Section>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <Section title="Bio" hint={`${draft.bio.trim().length}/40 characters minimum`}>
                <textarea
                  rows={5}
                  value={draft.bio}
                  onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
                  placeholder="Tell athletes about your background, coaching philosophy, and who you work best with."
                  className={`w-full rounded-2xl border bg-surface px-4 py-3 text-sm outline-none resize-none ${
                    bioOk ? "border-border focus:border-lime" : "border-border focus:border-coral"
                  }`}
                />
              </Section>

              <Section title="Session types (optional)">
                <ChipPicker
                  options={SESSION_TYPES}
                  selected={draft.sessionTypes}
                  onToggle={(v) =>
                    setDraft((d) => ({
                      ...d,
                      sessionTypes: d.sessionTypes.includes(v)
                        ? d.sessionTypes.filter((x) => x !== v)
                        : [...d.sessionTypes, v],
                    }))
                  }
                />
              </Section>

              <Section title="Age groups you coach (optional)">
                <AgeGroupPicker
                  selected={draft.ageGroups}
                  onChange={(next) => setDraft((d) => ({ ...d, ageGroups: next }))}
                />
              </Section>

              <Section title="Credentials (optional)">
                <div className="flex gap-2">
                  <input
                    value={credInput}
                    onChange={(e) => setCredInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCred())}
                    placeholder="USATF Level 2"
                    className="flex-1 rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                  />
                  <button
                    type="button"
                    onClick={addCred}
                    className="rounded-2xl bg-lime px-4 text-sm font-bold text-primary-foreground"
                  >
                    Add
                  </button>
                </div>
                {draft.credentials.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {draft.credentials.map((c, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 rounded-full border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-bold text-lime"
                      >
                        {c}
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              credentials: d.credentials.filter((_, j) => j !== i),
                            }))
                          }
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </Section>

              <Section
                title="Gym (optional)"
                hint="Attach a gym or academy. Pick one to request to join, or add a new one you own."
              >
                {draft.orgChoice.mode === "existing" && draft.orgChoice.orgId ? (
                  <div className="flex items-center justify-between rounded-2xl border border-lime/40 bg-lime/10 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="micro-label text-lime font-bold">
                        Join request on publish
                      </div>
                      <div className="truncate text-sm font-bold">{draft.orgChoice.name}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, orgChoice: { mode: null } }))}
                      className="rounded-full border border-border bg-background p-1.5"
                      aria-label="Clear organization"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : draft.orgChoice.mode === "new" && draft.orgChoice.name ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-2xl border border-coral/40 bg-coral/10 px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="micro-label text-coral font-bold">
                          You'll own this new org
                        </div>
                        <div className="truncate text-sm font-bold">{draft.orgChoice.name}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, orgChoice: { mode: null } }))}
                        className="rounded-full border border-border bg-background p-1.5"
                        aria-label="Clear organization"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <LocationAutocomplete
                      value={draft.orgChoice.address ?? ""}
                      onChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          orgChoice: { ...d.orgChoice, address: v, placeId: undefined, geo: null },
                        }))
                      }
                      onPick={(v, placeId, geo) =>
                        setDraft((d) => ({
                          ...d,
                          orgChoice: {
                            ...d.orgChoice,
                            address: v,
                            placeId,
                            geo: geo ? { lat: geo.lat, lng: geo.lng } : null,
                          },
                        }))
                      }
                      placeholder="Gym / org address (optional)"
                      mode="place"
                      showCurrentButton={false}
                    />
                    {draft.orgChoice.geo && draft.orgChoice.address && (
                      <div className="overflow-hidden rounded-2xl border border-border">
                        <VenueMapPreview
                          address={draft.orgChoice.address}
                          lat={draft.orgChoice.geo.lat}
                          lng={draft.orgChoice.geo.lng}
                          placeId={draft.orgChoice.placeId}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <input
                      value={orgSearch}
                      onChange={(e) => setOrgSearch(e.target.value)}
                      placeholder="Search gyms / academies…"
                      className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                    />
                    {orgSearch.trim().length >= 2 && (
                      <div className="mt-2 space-y-1.5">
                        {orgResults.isLoading && (
                          <div className="text-[11px] text-muted-foreground">Searching…</div>
                        )}
                        {orgResults.data?.slice(0, 6).map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() =>
                              setDraft((d) => ({
                                ...d,
                                orgChoice: { mode: "existing", orgId: o.id, name: o.name },
                              }))
                            }
                            className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface px-3 py-2.5 text-left hover:border-lime"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold">{o.name}</div>
                              <div className="text-[11px] text-muted-foreground">
                                @{o.handle}
                                {o.city ? ` · ${o.city}` : ""}
                              </div>
                            </div>
                            <Plus className="h-4 w-4 text-lime shrink-0" />
                          </button>
                        ))}
                        {orgResults.data &&
                          orgResults.data.length === 0 &&
                          !orgResults.isLoading && (
                            <div className="text-[11px] text-muted-foreground">
                              No match on BallaCity.
                            </div>
                          )}
                        {placesResults.data?.suggestions &&
                          placesResults.data.suggestions.length > 0 && (
                            <>
                              <div className="pt-1 micro-label text-muted-foreground">
                                From Google
                              </div>
                              {placesResults.data.suggestions.map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => pickPlaceAsNewOrg(s.id, s.primary, s.secondary)}
                                  className="flex w-full items-start gap-2 rounded-2xl border border-border bg-surface px-3 py-2.5 text-left hover:border-lime"
                                >
                                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-coral" />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-bold">{s.primary}</div>
                                    {s.secondary && (
                                      <div className="truncate text-[11px] text-muted-foreground">
                                        {s.secondary}
                                      </div>
                                    )}
                                  </div>
                                  <Plus className="h-4 w-4 text-lime shrink-0" />
                                </button>
                              ))}
                            </>
                          )}
                        {placesResults.isLoading && (
                          <div className="text-[11px] text-muted-foreground">Searching Google…</div>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              orgChoice: { mode: "new", name: orgSearch.trim() },
                            }))
                          }
                          className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-coral/40 bg-coral/5 px-3 py-2.5 text-xs font-bold text-coral hover:border-coral"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Create new org "{orgSearch.trim()}"
                        </button>
                      </div>
                    )}
                  </>
                )}
              </Section>

              <Section title="Hourly rate">
                <div className="rounded-2xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-muted-foreground">Per hour</span>
                    <span className="font-display text-2xl font-bold text-lime">${draft.rate}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={300}
                    step={5}
                    value={draft.rate}
                    onChange={(e) => setDraft((d) => ({ ...d, rate: +e.target.value }))}
                    className="w-full accent-lime"
                  />
                </div>
              </Section>

              <Section title="Skill range you work with">
                <div className="rounded-2xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-muted-foreground">Who fits here?</span>
                    <span className="text-sm font-bold text-lime">
                      {SKILL_LABELS[draft.skillMin - 1]} – {SKILL_LABELS[draft.skillMax - 1]}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="rounded-xl border border-border bg-background/60 px-3 py-2">
                      <div className="micro-label text-muted-foreground">
                        Min
                      </div>
                      <select
                        value={draft.skillMin}
                        onChange={(e) => {
                          const v = +e.target.value;
                          setDraft((d) => ({
                            ...d,
                            skillMin: v,
                            skillMax: Math.max(v, d.skillMax),
                          }));
                        }}
                        className="w-full bg-transparent text-sm font-bold outline-none"
                      >
                        {SKILL_LABELS.map((l, i) => (
                          <option key={l} value={i + 1}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="rounded-xl border border-border bg-background/60 px-3 py-2">
                      <div className="micro-label text-muted-foreground">
                        Max
                      </div>
                      <select
                        value={draft.skillMax}
                        onChange={(e) => {
                          const v = +e.target.value;
                          setDraft((d) => ({
                            ...d,
                            skillMax: v,
                            skillMin: Math.min(v, d.skillMin),
                          }));
                        }}
                        className="w-full bg-transparent text-sm font-bold outline-none"
                      >
                        {SKILL_LABELS.map((l, i) => (
                          <option key={l} value={i + 1}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              </Section>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <Section
                title="Venues"
                hint="Add every place where you train. Pick from Google suggestions so we can verify + map them. Star your default primary venue."
              >
                {verifiedVenues.length > 0 && (
                  <ul className="space-y-2">
                    {draft.venues.map((v, idx) => {
                      const isPrimary = primaryVenue?.address === v.address && !!v.placeId;
                      return (
                        <li
                          key={`${v.placeId || "unverified"}-${idx}`}
                          className={`rounded-2xl border px-3 py-2.5 ${isPrimary ? "border-lime/50 bg-lime/10" : "border-border bg-surface"}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                {isPrimary && (
                                  <span className="micro-label text-lime font-bold">
                                    ★ Primary
                                  </span>
                                )}
                                {!v.placeId && (
                                  <span className="micro-label text-coral font-bold">
                                    Unverified
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-sm font-semibold">{v.address}</div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {!isPrimary && v.placeId && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const target = verifiedVenues.findIndex(
                                      (x) => x.placeId === v.placeId,
                                    );
                                    if (target >= 0)
                                      setDraft((d) => ({ ...d, primaryVenueIdx: target }));
                                  }}
                                  className="rounded-full border border-border bg-background px-2 py-1 text-[10px] font-bold hover:border-lime"
                                >
                                  Make primary
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setDraft((d) => {
                                    const nextVenues = d.venues.filter((_, i) => i !== idx);
                                    const nextVerified = nextVenues.filter(
                                      (x) => x.address.trim() && x.placeId,
                                    );
                                    const nextIdx = Math.min(
                                      d.primaryVenueIdx,
                                      Math.max(nextVerified.length - 1, 0),
                                    );
                                    return { ...d, venues: nextVenues, primaryVenueIdx: nextIdx };
                                  })
                                }
                                className="rounded-full border border-border bg-background p-1.5"
                                aria-label="Remove venue"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          {v.placeId && v.geo && (
                            <div className="mt-2">
                              <VenueMapPreview
                                address={v.address}
                                lat={v.geo.lat}
                                lng={v.geo.lng}
                                placeId={v.placeId}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="space-y-2">
                  <label className="micro-label text-muted-foreground font-bold">
                    Add a venue
                  </label>
                  <LocationAutocomplete
                    value={venueInput}
                    onChange={setVenueInput}
                    onPick={(full, placeId, geo) => {
                      if (!placeId) return;
                      let added = false;
                      setDraft((d) => {
                        if (d.venues.some((x) => x.placeId === placeId)) {
                          toast.message("That venue is already added.");
                          return d;
                        }
                        const nextVenues = [
                          ...d.venues,
                          {
                            address: full,
                            placeId,
                            geo: geo ? { lat: geo.lat, lng: geo.lng } : null,
                          },
                        ];
                        const nextVerifiedLen = nextVenues.filter(
                          (x) => x.address.trim() && x.placeId,
                        ).length;
                        const nextIdx = nextVerifiedLen === 1 ? 0 : d.primaryVenueIdx;
                        added = true;
                        return { ...d, venues: nextVenues, primaryVenueIdx: nextIdx };
                      });
                      if (added) setVenueInput("");
                    }}
                    placeholder="Start typing then pick a Google suggestion"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    You can add multiple venues and pick a different one for each availability
                    window in the next step.
                  </p>
                </div>
              </Section>

              <p className="text-[12px] text-muted-foreground">
                Timezone auto-detected:{" "}
                <span className="text-foreground font-semibold">{draft.timezone}</span>
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <Section
                title="Availability"
                hint="Set your weekly base hours and tap any date to add overrides or block a day. You can schedule up to 6 months out."
              >
                <AvailabilityCalendar
                  weekly={draft.slots}
                  overrides={draft.overrides}
                  venues={verifiedVenueAddresses}
                  primaryVenue={primaryVenue?.address ?? null}

                  timezone={draft.timezone}
                  onWeeklyChange={(slots) => setDraft((d) => ({ ...d, slots }))}
                  onOverridesChange={(overrides) => setDraft((d) => ({ ...d, overrides }))}
                />
              </Section>

              <Section
                title="Recurring rules (optional)"
                hint="For patterns like every other Tuesday."
              >
                <AvailabilityRulesEditor
                  value={draft.rules}
                  onChange={(rules) => setDraft((d) => ({ ...d, rules }))}
                  venues={verifiedVenueAddresses}
                />
              </Section>

              <Section title="Live preview">
                <div className="rounded-3xl border border-lime/30 bg-surface/40 p-3">
                  <OrgCard org={previewOrg} />
                </div>
                <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-lime" /> This is how athletes will see you in
                  feeds.
                </div>
              </Section>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+6rem)] left-0 right-0 z-30 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 bg-gradient-to-t from-background via-background/90 to-transparent">
        <div className="mx-auto flex w-full max-w-lg gap-2">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep(Math.max(0, step - 1))}
              className="rounded-2xl border border-border bg-surface px-5 py-3.5 text-sm font-bold"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={() => nav({ to: "/trainers" })}
              className="rounded-2xl border border-border bg-surface px-5 py-3.5 text-sm font-bold"
            >
              Cancel
            </button>
          )}
          {step < STEP_LABELS.length - 1 ? (
            <>
              {canSkip && (
                <button
                  type="button"
                  onClick={() => setStep(step + 1)}
                  className="rounded-2xl border border-border bg-surface px-4 py-3.5 text-xs font-bold text-muted-foreground"
                >
                  Skip
                </button>
              )}
              <motion.button
                whileTap={{ scale: 0.98 }}
                type="button"
                disabled={!canNext}
                onClick={() => setStep(step + 1)}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-lime-gradient py-3.5 text-sm font-bold text-primary-foreground glow-lime disabled:opacity-40"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </motion.button>
            </>
          ) : (
            <div className="flex-1 flex flex-col gap-1">
              <motion.button
                whileTap={{ scale: 0.98 }}
                type="button"
                onClick={submit}
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-coral-gradient py-3.5 text-sm font-bold text-white glow-coral disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" />
                {submitting ? "Publishing…" : "Publish profile"}
              </motion.button>
              {submitError && (
                <div className="text-[11px] text-coral text-center">{submitError}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="section-eyebrow text-muted-foreground">{title}</div>
        {hint && <div className="text-[10px] text-muted-foreground text-right">{hint}</div>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ChipPicker({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? "border-lime bg-lime/10 text-lime"
                : "border-border bg-surface text-muted-foreground hover:border-lime/40"
            }`}
            aria-pressed={active}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

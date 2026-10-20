import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Sparkles, X, Plus } from "lucide-react";
import {
  SPORTS,
  HERO_IMAGE,
  POSITIONS_BY_SPORT,
  type Sport,
  type Org,
  type OrgKind,
} from "@/lib/sample-data";
import { addOrg } from "@/lib/org-store";
import { validateSlots, validateOverrides, type DayOverride } from "@/lib/availability-slots";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { AvailabilityRulesEditor } from "@/components/AvailabilityRulesEditor";
import type { AvailabilityRule } from "@/lib/availability-resolve";
import { validateRules } from "@/lib/availability-slots";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { validateVenueList, buildVenueGeo } from "@/lib/venue-address";
import {
  SPORT_CONFIG,
  SESSION_TYPES,
  RATING_SYSTEM_LABEL,
  primarySport,
  mergedFormats,
  mergedVenues,
  mergedCadences,
  mergedCredentialPresets,
  ratingSystemFor,
  ratingLevelsFor,
  hasTeamSport,
  hasRunning,
} from "@/lib/sport-config";
import { OrgCard } from "@/components/OrgCard";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { VenueMapPreview } from "@/components/VenueMapPreview";
import { ImageUploader } from "@/components/ImageUploader";
import { LogoWithInitialsField } from "@/components/org/LogoWithInitialsField";
import { useAuth } from "@/hooks/use-auth";
import {
  PositionsPicker,
  positionsCleanup,
  type PositionsNeeded,
} from "@/components/PositionsPicker";
import {
  listTrainerOrgs,
  createTrainerOrg,
  requestToJoinTrainerOrg,
} from "@/lib/trainer-orgs.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { setActiveProfileByRef, myProfilesKey } from "@/lib/account-profiles";

const ACCENTS = [
  { name: "Lime", hex: "#a3ff12" },
  { name: "Coral", hex: "#ff3d68" },
  { name: "Mint", hex: "#7df9c1" },
  { name: "Amber", hex: "#ffd166" },
  { name: "Sky", hex: "#8ad6ff" },
  { name: "Orange", hex: "#ff8a3d" },
  { name: "Magenta", hex: "#e84393" },
  { name: "Violet", hex: "#a78bfa" },
];

const STEPS = ["Identity", "Details", "Branding"] as const;
const SKILL_LABELS = ["Beginner", "Recreational", "Intermediate", "Advanced", "Pro"] as const;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function CreateOrgWizard({ kind }: { kind: OrgKind }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isCoach = kind === "coach";
  const backHref = isCoach ? "/trainers" : "/teams";
  const [step, setStep] = useState(0);

  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [tagline, setTagline] = useState("");
  const [city, setCity] = useState("");
  const [founded, setFounded] = useState(new Date().getFullYear());
  const [sports, setSports] = useState<Sport[]>([]);
  const [bio, setBio] = useState("");
  const [achievements, setAchievements] = useState<string[]>([]);
  const [achInput, setAchInput] = useState("");
  // Team-only
  const [league, setLeague] = useState("");
  const [homeCourt, setHomeCourt] = useState("");
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [staff, setStaff] = useState<{ name: string; role: string; avatar: string }[]>([]);
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState("");
  // Coach-only
  const [credentials, setCredentials] = useState<string[]>([]);
  const [credInput, setCredInput] = useState("");
  const [rate, setRate] = useState(75);
  // Branding
  const [accent, setAccent] = useState(ACCENTS[0].hex);
  const [avatar, setAvatar] = useState("");
  const [cover, setCover] = useState<string>(HERO_IMAGE);
  const [customCover, setCustomCover] = useState(false);
  const [skillMin, setSkillMin] = useState(1);
  const [skillMax, setSkillMax] = useState(3);

  const [formats, setFormats] = useState<string[]>([]);
  const [venues, setVenues] = useState<string[]>([]);
  const [venueAddresses, setVenueAddresses] = useState<string[]>([]);
  const [verifiedVenues, setVerifiedVenues] = useState<Set<string>>(new Set());
  const [venueGeoMap, setVenueGeoMap] = useState<
    Record<string, { placeId: string; lat: number; lng: number }>
  >({});
  const [primaryVenue, setPrimaryVenue] = useState<string | null>(null);
  const [cadences, setCadences] = useState<string[]>([]);
  const [positionsBySport, setPositionsBySport] = useState<Record<string, PositionsNeeded>>({});
  const [ratingMin, setRatingMin] = useState<string>("");
  const [ratingMax, setRatingMax] = useState<string>("");
  const [distances, setDistances] = useState<string[]>([]);
  const [sessionTypes, setSessionTypes] = useState<string[]>([]);
  type Slot = NonNullable<Org["availabilitySlots"]>[number];
  const [slots, setSlots] = useState<Slot[]>([]);
  const [overrides, setOverrides] = useState<DayOverride[]>([]);
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [timezone, setTimezone] = useState<string>(() => {
    // Lazy import so SSR doesn't crash — `Intl` is universal but the helper is browser-tuned.
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
    } catch {
      return "America/New_York";
    }
  });
  const slotsError = useMemo(() => validateSlots(slots), [slots]);
  const overridesError = useMemo(
    () => validateOverrides(overrides, verifiedVenues),
    [overrides, verifiedVenues],
  );
  const rulesError = useMemo(() => validateRules(rules, verifiedVenues), [rules, verifiedVenues]);
  const venueValidation = useMemo(
    () => validateVenueList(venueAddresses, verifiedVenues),
    [venueAddresses, verifiedVenues],
  );
  const venuesError = isCoach && venueAddresses.length > 0 && venueValidation.hasError;

  const primary = primarySport(sports);
  const ratingSystem = ratingSystemFor(primary);
  const ratingLevels = ratingLevelsFor(primary);
  const usesSelfRating = ratingSystem === "SELF";
  const formatOptions = useMemo(() => mergedFormats(sports), [sports]);
  const venueOptions = useMemo(() => mergedVenues(sports), [sports]);
  const cadenceOptions = useMemo(() => mergedCadences(sports), [sports]);
  const credentialPresets = useMemo(() => mergedCredentialPresets(sports), [sports]);
  const showTeamBlocks = !isCoach && hasTeamSport(sports);
  const showDistances = hasRunning(sports);

  const computedAvatar = avatar || initials(name || "Open Run");

  const canNext = useMemo(() => {
    if (step === 0)
      return (
        name.trim().length > 1 &&
        handle.trim().length > 1 &&
        sports.length > 0 &&
        city.trim().length > 0
      );
    if (step === 1) return bio.trim().length > 10;
    if (step === 2) return true;
    return false;
  }, [step, name, handle, sports, city, bio]);

  const handlePreview: Org = {
    id: "preview",
    kind,
    name: name || "Your Org Name",
    handle: handle.startsWith("@") ? handle : `@${handle || "handle"}`,
    tagline: tagline || "Add a short tagline that describes what you do.",
    city: city || "Your city",
    founded,
    sports: sports.length ? sports : (["Basketball"] as Sport[]),
    verified: false,
    cover,
    avatar: computedAvatar,
    accent,
    followers: 0,
    roster: isCoach ? 0 : staff.length,
    bio,
    achievements,
    credentials: isCoach ? credentials : undefined,
    ratePerHour: isCoach ? rate : undefined,
    rating: undefined,
    reviews: isCoach ? 0 : undefined,
    league: isCoach ? undefined : league,
    record: isCoach ? undefined : { w: wins, l: losses },
    homeCourt: isCoach ? undefined : homeCourt,
    staff: isCoach ? undefined : staff,
    skillRange: { min: skillMin, max: skillMax },
    format: formats[0],
    formats,
    venues,
    venueAddresses: isCoach ? venueAddresses.filter((v) => v.trim().length > 0) : undefined,
    verifiedVenues: isCoach ? Array.from(verifiedVenues) : undefined,
    venueGeo: isCoach ? buildVenueGeo(venueAddresses, verifiedVenues, venueGeoMap) : undefined,
    primaryVenue: isCoach
      ? primaryVenue && venueAddresses.map((v) => v.trim()).includes(primaryVenue.trim())
        ? primaryVenue.trim()
        : undefined
      : undefined,
    cadence: cadences[0],
    cadences,
    positionsNeeded: Object.fromEntries(
      Object.entries(positionsBySport).map(([k, v]) => [k, positionsCleanup(v)]),
    ),
    ratingSystem,
    ratingMin: ratingMin || undefined,
    ratingMax: ratingMax || undefined,
    distances,
    sessionTypes: isCoach ? sessionTypes : undefined,
    availabilitySlots: isCoach
      ? slots
          .filter((s) => s.start && s.end && s.end > s.start)
          .map((s) => ({
            ...s,
            venue:
              s.venue && venueAddresses.map((v) => v.trim()).includes(s.venue.trim())
                ? s.venue.trim()
                : undefined,
          }))
      : undefined,
    availabilityOverrides: isCoach ? overrides : undefined,
    availabilityRules: isCoach ? rules : undefined,
    timezone: isCoach ? timezone : undefined,
    upcoming: [],
    posts: [],
  };

  // Trainer-only: organization affiliation choice
  type OrgChoice =
    | { mode: "independent" }
    | { mode: "join"; orgId: string; orgName: string }
    | {
        mode: "create";
        name: string;
        handle: string;
        city: string;
        bio: string;
        address?: string;
        placeId?: string;
        geo?: { lat: number; lng: number } | null;
      };
  const [orgChoice, setOrgChoice] = useState<OrgChoice>({ mode: "independent" });

  const [orgSearch, setOrgSearch] = useState("");
  const orgSearchResults = useQuery({
    queryKey: ["trainer-orgs-wizard-search", orgSearch],
    queryFn: () => listTrainerOrgs({ data: { search: orgSearch } }),
    enabled: isCoach && orgChoice.mode === "join",
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function submit() {
    if (submitting) return;
    if (isCoach && slotsError) {
      setSubmitError(slotsError.message);
      return;
    }
    if (isCoach && overridesError) {
      setSubmitError(overridesError.message);
      return;
    }
    if (isCoach && rulesError) {
      setSubmitError(rulesError.message);
      return;
    }
    if (venuesError) {
      setSubmitError(venueValidation.firstError ?? "Fix venue addresses");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const id = `${isCoach ? "c" : "t"}-${(name || "org").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36).slice(-4)}`;
    const handleClean = (handle.startsWith("@") ? handle.slice(1) : handle)
      .replace(/[^a-zA-Z0-9_]/g, "")
      .toLowerCase();
    const org: Org = {
      ...handlePreview,
      id,
      handle: `@${handleClean || "org"}`,
    };
    try {
      const saved = await addOrg(org);
      await setActiveProfileByRef(isCoach ? "trainer" : "team", saved.id).catch(() => {});
      await qc.invalidateQueries({ queryKey: myProfilesKey(user?.id), refetchType: "all" });
      if (isCoach) {
        // Best-effort org linkage — failures don't roll back the profile.
        try {
          if (orgChoice.mode === "create") {
            await createTrainerOrg({
              data: {
                name: orgChoice.name.trim(),
                handle: orgChoice.handle.trim(),
                trainerId: saved.id,
                city: orgChoice.city.trim() || undefined,
                bio: orgChoice.bio.trim() || undefined,
                address: orgChoice.address?.trim() || undefined,
                placeId: orgChoice.placeId || undefined,
                geo: orgChoice.geo ?? undefined,
              },
            });
            toast.success("Gym created");
          } else if (orgChoice.mode === "join") {
            await requestToJoinTrainerOrg({
              data: { orgId: orgChoice.orgId, trainerId: saved.id },
            });
            toast.success(`Join request sent to ${orgChoice.orgName}`);
          }
        } catch (e) {
          toast.error(
            e instanceof Error
              ? `Profile created, but org link failed: ${e.message}`
              : "Profile created, but org link failed.",
          );
        }
        nav({ to: "/trainers/$trainerId", params: { trainerId: saved.id } });
      } else {
        nav({ to: "/teams/$teamId", params: { teamId: saved.id } });
      }
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : `Failed to create ${isCoach ? "trainer" : "team"}.`;
      setSubmitError(
        /unauthor/i.test(msg) ? `Please sign in to create a ${isCoach ? "trainer" : "team"}.` : msg,
      );
      setSubmitting(false);
    }
  }

  function addAchievement() {
    const v = achInput.trim();
    if (!v) return;
    setAchievements((a) => [...a, v]);
    setAchInput("");
  }
  function addCred() {
    const v = credInput.trim();
    if (!v) return;
    setCredentials((a) => [...a, v]);
    setCredInput("");
  }
  function addStaff() {
    if (!staffName.trim() || !staffRole.trim()) return;
    setStaff((s) => [
      ...s,
      { name: staffName.trim(), role: staffRole.trim(), avatar: initials(staffName) },
    ]);
    setStaffName("");
    setStaffRole("");
  }
  function updateStaffAvatar(i: number, file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setStaff((s) => {
          const next = [...s];
          next[i] = { ...next[i], avatar: result };
          return next;
        });
      }
    };
    reader.readAsDataURL(file);
  }
  function resetStaffAvatar(i: number) {
    setStaff((s) => {
      const next = [...s];
      next[i] = { ...next[i], avatar: initials(next[i].name) };
      return next;
    });
  }

  function toggleSport(s: Sport) {
    setSports((arr) => (arr.includes(s) ? arr.filter((x) => x !== s) : [...arr, s]));
  }

  return (
    <div className="page-shell-narrow pt-6 pb-32">
      <div className="flex items-center gap-3 mb-4">
        <Link
          to={backHref}
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="micro-label text-muted-foreground font-bold">
            Step {step + 1} of {STEPS.length}
          </div>
          <h1 className="font-display text-xl font-bold leading-tight">{STEPS[step]}</h1>
        </div>
      </div>

      <div className="flex gap-1.5 mb-6">
        {STEPS.map((_, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full overflow-hidden bg-secondary`}>
            <motion.div
              initial={false}
              animate={{ width: i <= step ? "100%" : "0%" }}
              transition={{ duration: 0.4 }}
              className="h-full bg-lime-gradient"
            />
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.25 }}
        >
          {step === 0 && (
            <div className="space-y-5">
              <Section title={isCoach ? "Trainer name" : "Team name"}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={isCoach ? "Trainer Jordan Kim" : "Eastside Elite"}
                  className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                />
              </Section>

              <Section title="Handle">
                <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 focus-within:border-lime">
                  <span className="text-muted-foreground">@</span>
                  <input
                    value={handle.replace(/^@/, "")}
                    onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                    placeholder="yourhandle"
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </Section>

              <Section title="Tagline">
                <input
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  maxLength={80}
                  placeholder="One line that sums you up"
                  className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                />
                <div className="text-right text-[10px] text-muted-foreground">
                  {tagline.length}/80
                </div>
              </Section>

              <Section title="City">
                <LocationAutocomplete
                  value={city}
                  onChange={setCity}
                  placeholder="Brooklyn, NY"
                  mode="city"
                />
              </Section>

              <Section title="Sports">
                <div className="grid grid-cols-3 gap-2">
                  {SPORTS.map((s) => {
                    const active = sports.includes(s.name);
                    return (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => toggleSport(s.name)}
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

              {sports.length > 0 && formatOptions.length > 0 && (
                <Section title="Preferred formats">
                  <ChipPicker
                    options={formatOptions}
                    selected={formats}
                    onToggle={(v) =>
                      setFormats((cur) =>
                        cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
                      )
                    }
                  />
                </Section>
              )}

              {sports.length > 0 && venueOptions.length > 0 && (
                <Section title="Venues / surfaces">
                  <ChipPicker
                    options={venueOptions}
                    selected={venues}
                    onToggle={(v) =>
                      setVenues((cur) =>
                        cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
                      )
                    }
                  />
                </Section>
              )}

              {sports.length > 0 && (
                <Section title="Meeting cadence">
                  <ChipPicker
                    options={cadenceOptions}
                    selected={cadences}
                    onToggle={(v) =>
                      setCadences((cur) =>
                        cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
                      )
                    }
                  />
                </Section>
              )}

              {isCoach && (
                <Section title="Session venues">
                  <div className="space-y-2">
                    {venueAddresses.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Add one or more addresses where you hold sessions.
                      </p>
                    )}
                    {venueAddresses.map((addr, i) => {
                      const rowError = venueValidation.errors[i];
                      const trimmed = addr.trim();
                      const isPrimary = !!trimmed && primaryVenue?.trim() === trimmed;
                      return (
                        <div key={i} className="space-y-1">
                          <div className="flex items-start gap-2">
                            <div
                              className={`flex-1 ${rowError ? "rounded-2xl ring-1 ring-coral" : ""}`}
                            >
                              <LocationAutocomplete
                                value={addr}
                                onChange={(v) => {
                                  const prevTrim = trimmed;
                                  const prevKey = prevTrim.toLowerCase();
                                  const newKey = v.trim().toLowerCase();
                                  setVenueAddresses((cur) => cur.map((a, j) => (j === i ? v : a)));
                                  // Free-typed edits invalidate a previously verified entry.
                                  if (prevKey && prevKey !== newKey) {
                                    setVerifiedVenues((cur) => {
                                      if (!cur.has(prevKey)) return cur;
                                      const next = new Set(cur);
                                      next.delete(prevKey);
                                      return next;
                                    });
                                    setVenueGeoMap((cur) => {
                                      if (!(prevKey in cur)) return cur;
                                      const next = { ...cur };
                                      delete next[prevKey];
                                      return next;
                                    });
                                  }
                                  if (isPrimary) setPrimaryVenue(v.trim() || null);
                                  if (prevTrim) {
                                    setSlots((cur) =>
                                      cur.map((s) =>
                                        s.venue?.trim() === prevTrim
                                          ? { ...s, venue: v.trim() || undefined }
                                          : s,
                                      ),
                                    );
                                  }
                                }}
                                onPick={(full, placeId, geo) => {
                                  const key = full.trim().toLowerCase();
                                  const prevKey = trimmed.toLowerCase();
                                  setVenueAddresses((cur) =>
                                    cur.map((a, j) => (j === i ? full : a)),
                                  );
                                  setVerifiedVenues((cur) => {
                                    const next = new Set(cur);
                                    if (prevKey && prevKey !== key) next.delete(prevKey);
                                    next.add(key);
                                    return next;
                                  });
                                  if (geo) {
                                    setVenueGeoMap((cur) => {
                                      const next = { ...cur };
                                      if (prevKey && prevKey !== key) delete next[prevKey];
                                      next[key] = { placeId, lat: geo.lat, lng: geo.lng };
                                      return next;
                                    });
                                  }
                                  if (isPrimary) setPrimaryVenue(full.trim());
                                  if (trimmed) {
                                    setSlots((cur) =>
                                      cur.map((s) =>
                                        s.venue?.trim() === trimmed
                                          ? { ...s, venue: full.trim() }
                                          : s,
                                      ),
                                    );
                                  }
                                }}
                                placeholder="Start typing then pick a Google suggestion"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                if (isPrimary) setPrimaryVenue(null);
                                if (trimmed) {
                                  setSlots((cur) =>
                                    cur.map((s) =>
                                      s.venue?.trim() === trimmed ? { ...s, venue: undefined } : s,
                                    ),
                                  );
                                  setVerifiedVenues((cur) => {
                                    const key = trimmed.toLowerCase();
                                    if (!cur.has(key)) return cur;
                                    const next = new Set(cur);
                                    next.delete(key);
                                    return next;
                                  });
                                  setVenueGeoMap((cur) => {
                                    const key = trimmed.toLowerCase();
                                    if (!(key in cur)) return cur;
                                    const next = { ...cur };
                                    delete next[key];
                                    return next;
                                  });
                                }
                                setVenueAddresses((cur) => cur.filter((_, j) => j !== i));
                              }}
                              className="mt-1 rounded-full p-2 text-muted-foreground hover:bg-surface"
                              aria-label="Remove venue"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="flex items-center justify-between gap-2 px-1">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={!trimmed || !!rowError}
                                onClick={() => setPrimaryVenue(isPrimary ? null : trimmed)}
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
                                  isPrimary
                                    ? "border-lime bg-lime/20 text-lime"
                                    : "border-border bg-surface text-muted-foreground hover:border-lime hover:text-lime"
                                } disabled:opacity-40 disabled:cursor-not-allowed`}
                              >
                                {isPrimary ? "★ Primary" : "Set as primary"}
                              </button>
                              {trimmed &&
                                verifiedVenues.has(trimmed.toLowerCase()) &&
                                !rowError && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-lime/40 bg-lime/10 px-2 py-0.5 text-[11px] font-semibold text-lime">
                                    <Check className="h-3 w-3" /> Verified
                                  </span>
                                )}
                            </div>
                            {rowError && <p className="text-[11px] text-coral">{rowError}</p>}
                          </div>
                          {(() => {
                            const geo = venueGeoMap[trimmed.toLowerCase()];
                            return trimmed && geo && !rowError ? (
                              <VenueMapPreview
                                address={trimmed}
                                lat={geo.lat}
                                lng={geo.lng}
                                placeId={geo.placeId}
                              />
                            ) : null;
                          })()}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setVenueAddresses((cur) => [...cur, ""])}
                      className="inline-flex items-center gap-1.5 rounded-2xl border border-dashed border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground hover:border-lime"
                    >
                      <Plus className="h-4 w-4" /> Add venue
                    </button>
                  </div>
                </Section>
              )}

              {isCoach && (
                <Section title="Availability calendar">
                  <p className="text-xs text-muted-foreground mb-2">
                    Set the times you're usually free (weekly pattern) and tap any date up to 6
                    months out to override or close it. Attendees see these times automatically
                    converted to their own timezone.
                  </p>
                  <div className="mb-3">
                    <TimezoneSelect value={timezone} onChange={setTimezone} />
                  </div>
                  <AvailabilityCalendar
                    weekly={slots}
                    overrides={overrides}
                    venues={venueAddresses
                      .map((v) => v.trim())
                      .filter(
                        (v, idx, arr) =>
                          v && verifiedVenues.has(v.toLowerCase()) && arr.indexOf(v) === idx,
                      )}
                    primaryVenue={primaryVenue}
                    timezone={timezone}
                    onWeeklyChange={setSlots}
                    onOverridesChange={setOverrides}
                  />
                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="mb-2">
                      <div className="text-sm font-semibold">Recurring rules</div>
                      <p className="text-xs text-muted-foreground">
                        Set patterns like "Every Tue/Thu" or "1st & 3rd Monday" — they auto-fill the
                        calendar.
                      </p>
                    </div>
                    <AvailabilityRulesEditor
                      value={rules}
                      onChange={setRules}
                      venues={venueAddresses
                        .map((v) => v.trim())
                        .filter(
                          (v, idx, arr) =>
                            v && verifiedVenues.has(v.toLowerCase()) && arr.indexOf(v) === idx,
                        )}
                    />
                  </div>
                </Section>
              )}

              <Section title="Skill range">
                <div className="rounded-2xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-muted-foreground">Who fits here?</span>
                    <span className="text-sm font-bold text-lime">
                      {SKILL_LABELS[skillMin - 1]} – {SKILL_LABELS[skillMax - 1]}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="rounded-xl border border-border bg-background/60 px-3 py-2">
                      <div className="micro-label text-muted-foreground">
                        Min
                      </div>
                      <select
                        value={skillMin}
                        onChange={(e) => {
                          const v = +e.target.value;
                          setSkillMin(v);
                          if (v > skillMax) setSkillMax(v);
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
                        value={skillMax}
                        onChange={(e) => {
                          const v = +e.target.value;
                          setSkillMax(v);
                          if (v < skillMin) setSkillMin(v);
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

              {!usesSelfRating && (
                <Section title={`${RATING_SYSTEM_LABEL[ratingSystem]} band`}>
                  <div className="rounded-2xl border border-border bg-surface p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm text-muted-foreground">
                        {ratingSystem === "PACE" ? "Typical pace range" : "Rating range"}
                      </span>
                      <span className="text-sm font-bold text-lime">
                        {ratingMin || "—"} – {ratingMax || "—"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="rounded-xl border border-border bg-background/60 px-3 py-2">
                        <div className="micro-label text-muted-foreground">
                          Min
                        </div>
                        <select
                          value={ratingMin}
                          onChange={(e) => setRatingMin(e.target.value)}
                          className="w-full bg-transparent text-sm font-bold outline-none"
                        >
                          <option value="">—</option>
                          {ratingLevels.map((l) => (
                            <option key={l} value={l}>
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
                          value={ratingMax}
                          onChange={(e) => setRatingMax(e.target.value)}
                          className="w-full bg-transparent text-sm font-bold outline-none"
                        >
                          <option value="">—</option>
                          {ratingLevels.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                </Section>
              )}

              <Section title="Year founded">
                <input
                  type="number"
                  min={1900}
                  max={new Date().getFullYear()}
                  value={founded}
                  onChange={(e) => setFounded(+e.target.value)}
                  className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                />
              </Section>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <Section title="Bio">
                <textarea
                  rows={5}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={
                    isCoach
                      ? "Tell athletes about your background, coaching philosophy, and who you work best with."
                      : "Tell players who you are, your vibe, and what kind of athletes thrive here."
                  }
                  className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime resize-none"
                />
              </Section>

              <Section title="Achievements">
                <div className="flex gap-2">
                  <input
                    value={achInput}
                    onChange={(e) => setAchInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addAchievement())}
                    placeholder="2024 League Finalist"
                    className="flex-1 rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                  />
                  <button
                    type="button"
                    onClick={addAchievement}
                    className="rounded-2xl bg-lime px-4 text-sm font-bold text-primary-foreground"
                  >
                    Add
                  </button>
                </div>
                {achievements.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {achievements.map((a, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between rounded-2xl border border-border bg-surface px-3 py-2 text-sm"
                      >
                        <span>🏆 {a}</span>
                        <button
                          type="button"
                          onClick={() => setAchievements((arr) => arr.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-coral"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {!isCoach && (
                <>
                  <Section title="League">
                    <input
                      value={league}
                      onChange={(e) => setLeague(e.target.value)}
                      placeholder="Cosmopolitan Soccer League · Div 3"
                      className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                    />
                  </Section>

                  <Section title="Home court / venue">
                    <LocationAutocomplete
                      value={homeCourt}
                      onChange={setHomeCourt}
                      mode="place"
                      showCurrentButton={false}
                      placeholder="Tompkins Square Courts"
                    />
                  </Section>

                  <Section title="Record (optional)">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="rounded-2xl border border-border bg-surface px-4 py-3">
                        <div className="micro-label text-muted-foreground">
                          Wins
                        </div>
                        <input
                          type="number"
                          min={0}
                          value={wins}
                          onChange={(e) => setWins(+e.target.value)}
                          className="w-full bg-transparent font-display text-xl font-bold text-lime outline-none"
                        />
                      </label>
                      <label className="rounded-2xl border border-border bg-surface px-4 py-3">
                        <div className="micro-label text-muted-foreground">
                          Losses
                        </div>
                        <input
                          type="number"
                          min={0}
                          value={losses}
                          onChange={(e) => setLosses(+e.target.value)}
                          className="w-full bg-transparent font-display text-xl font-bold text-coral outline-none"
                        />
                      </label>
                    </div>
                  </Section>

                  <Section title="Staff & captains">
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={staffName}
                          onChange={(e) => setStaffName(e.target.value)}
                          placeholder="Name"
                          className="rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-lime"
                        />
                        <input
                          value={staffRole}
                          onChange={(e) => setStaffRole(e.target.value)}
                          placeholder="Role (e.g. Head Coach)"
                          className="rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-lime"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={addStaff}
                        className="w-full rounded-2xl border border-dashed border-border bg-surface/40 py-2.5 text-sm font-semibold text-muted-foreground hover:border-lime hover:text-lime inline-flex items-center justify-center gap-1.5"
                      >
                        <Plus className="h-4 w-4" /> Add staff member
                      </button>
                      {staff.map((m, i) => {
                        const hasCustomAvatar = m.avatar.startsWith("data:");
                        return (
                          <div
                            key={i}
                            className="flex items-center gap-2 rounded-2xl border border-border bg-surface p-3"
                          >
                            <label className="relative shrink-0 cursor-pointer">
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) updateStaffAvatar(i, file);
                                }}
                              />
                              {hasCustomAvatar ? (
                                <img
                                  src={m.avatar}
                                  alt=""
                                  className="h-10 w-10 rounded-full object-cover"
                                />
                              ) : (
                                <div className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-xs font-bold">
                                  {m.avatar}
                                </div>
                              )}
                              <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-lime text-[8px] font-bold text-primary-foreground">
                                +
                              </span>
                            </label>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold truncate">{m.name}</div>
                              <div className="text-xs text-muted-foreground truncate">{m.role}</div>
                            </div>
                            {hasCustomAvatar && (
                              <button
                                type="button"
                                onClick={() => resetStaffAvatar(i)}
                                className="text-muted-foreground hover:text-lime"
                                title="Reset to initials"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setStaff((s) => s.filter((_, j) => j !== i))}
                              className="text-muted-foreground hover:text-coral"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </Section>
                </>
              )}

              {showTeamBlocks &&
                sports
                  .filter((s) => (POSITIONS_BY_SPORT[s]?.length ?? 0) > 0)
                  .map((s) => (
                    <Section key={`pos-${s}`} title={`${s} — positions needed`}>
                      <PositionsPicker
                        sport={s}
                        value={positionsBySport[s] ?? {}}
                        onChange={(next) => setPositionsBySport((cur) => ({ ...cur, [s]: next }))}
                      />
                    </Section>
                  ))}

              {showDistances && (
                <Section title="Typical distances">
                  <ChipPicker
                    options={SPORT_CONFIG.Running?.distances ?? []}
                    selected={distances}
                    onToggle={(v) =>
                      setDistances((cur) =>
                        cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
                      )
                    }
                  />
                </Section>
              )}

              {isCoach && (
                <>
                  <Section title="Session types">
                    <ChipPicker
                      options={SESSION_TYPES}
                      selected={sessionTypes}
                      onToggle={(v) =>
                        setSessionTypes((cur) =>
                          cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
                        )
                      }
                    />
                  </Section>

                  {credentialPresets.length > 0 && (
                    <Section title="Suggested credentials">
                      <ChipPicker
                        options={credentialPresets}
                        selected={credentials}
                        onToggle={(v) =>
                          setCredentials((cur) =>
                            cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
                          )
                        }
                      />
                    </Section>
                  )}
                  <Section title="Credentials">
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
                    {credentials.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {credentials.map((c, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1.5 rounded-full border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-bold text-lime"
                          >
                            {c}
                            <button
                              type="button"
                              onClick={() => setCredentials((arr) => arr.filter((_, j) => j !== i))}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </Section>

                  <Section title="Hourly rate">
                    <div className="rounded-2xl border border-border bg-surface p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm text-muted-foreground">Per hour</span>
                        <span className="font-display text-2xl font-bold text-lime">${rate}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={300}
                        step={5}
                        value={rate}
                        onChange={(e) => setRate(+e.target.value)}
                        className="w-full accent-lime"
                      />
                    </div>
                  </Section>
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <Section title="Accent color">
                <div className="grid grid-cols-4 gap-2">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.hex}
                      type="button"
                      onClick={() => setAccent(a.hex)}
                      className={`group relative aspect-square rounded-2xl border-2 transition-all ${
                        accent === a.hex ? "border-foreground scale-105" : "border-transparent"
                      }`}
                      style={{ background: `linear-gradient(135deg, ${a.hex}, ${a.hex}aa)` }}
                      aria-label={a.name}
                    >
                      {accent === a.hex && (
                        <Check className="absolute inset-0 m-auto h-5 w-5 text-primary-foreground" />
                      )}
                    </button>
                  ))}
                </div>
              </Section>

              <Section title={isCoach ? "Trainer photo" : "Team logo"}>
                <LogoWithInitialsField
                  value={avatar}
                  onChange={setAvatar}
                  defaultInitials={initials(name || "OR")}
                  bucket={isCoach ? "trainer-avatars" : "team-avatars"}
                  pathPrefix={user?.id}
                  logo={!isCoach}
                  label={isCoach ? "Trainer photo" : "Team logo"}
                />
              </Section>

              <Section title={isCoach ? "Cover image" : "Team cover"}>
                <ImageUploader
                  kind="cover"
                  bucket="team-covers"
                  pathPrefix={user?.id}
                  value={customCover ? cover : ""}
                  fallback={cover}
                  onChange={(url) => {
                    setCover(url);
                    setCustomCover(true);
                  }}
                  onClear={() => {
                    setCover(HERO_IMAGE);
                    setCustomCover(false);
                  }}
                  presets={sports.length ? sports : undefined}
                />
              </Section>

              {isCoach && (
                <Section title="Gym (optional)">
                  <div className="flex gap-2">
                    {(["independent", "join", "create"] as const).map((m) => {
                      const active = orgChoice.mode === m;
                      const label =
                        m === "independent"
                          ? "Independent"
                          : m === "join"
                            ? "Join existing"
                            : "Create new";
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            if (m === "independent") setOrgChoice({ mode: "independent" });
                            else if (m === "join")
                              setOrgChoice({ mode: "join", orgId: "", orgName: "" });
                            else
                              setOrgChoice({
                                mode: "create",
                                name: "",
                                handle: "",
                                city: "",
                                bio: "",
                              });
                          }}
                          className={`flex-1 rounded-2xl border px-3 py-2 text-xs font-semibold transition-colors ${
                            active
                              ? "border-lime bg-lime/10 text-lime"
                              : "border-border bg-surface text-muted-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {orgChoice.mode === "join" && (
                    <div className="mt-2 space-y-2">
                      <input
                        value={orgSearch}
                        onChange={(e) => setOrgSearch(e.target.value)}
                        placeholder="Search gyms…"
                        className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                      />
                      <div className="max-h-56 overflow-auto space-y-1">
                        {(orgSearchResults.data ?? []).map((o) => {
                          const selected = orgChoice.orgId === o.id;
                          return (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() =>
                                setOrgChoice({ mode: "join", orgId: o.id, orgName: o.name })
                              }
                              className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-left ${
                                selected
                                  ? "border-lime bg-lime/10"
                                  : "border-border/50 bg-background"
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">
                                  {o.name}
                                  {o.verified ? " ✓" : ""}
                                </div>
                                <div className="text-[11px] text-muted-foreground truncate">
                                  @{o.handle}
                                  {o.city ? ` · ${o.city}` : ""}
                                </div>
                              </div>
                              {selected && <Check className="h-4 w-4 text-lime shrink-0" />}
                            </button>
                          );
                        })}
                        {orgSearchResults.data && orgSearchResults.data.length === 0 && (
                          <div className="text-[11px] text-muted-foreground px-2 py-3">
                            No gyms found. Try a different search or create a new one.
                          </div>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        A join request will be sent to the gym after your profile is published.
                      </p>
                    </div>
                  )}

                  {orgChoice.mode === "create" && (
                    <div className="mt-2 space-y-2">
                      <input
                        value={orgChoice.name}
                        onChange={(e) => setOrgChoice({ ...orgChoice, name: e.target.value })}
                        placeholder="Gym name"
                        className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                      />
                      <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 focus-within:border-lime">
                        <span className="text-muted-foreground">@</span>
                        <input
                          value={orgChoice.handle}
                          onChange={(e) =>
                            setOrgChoice({
                              ...orgChoice,
                              handle: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                            })
                          }
                          placeholder="orghandle"
                          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                        />
                      </div>
                      <input
                        value={orgChoice.city}
                        onChange={(e) => setOrgChoice({ ...orgChoice, city: e.target.value })}
                        placeholder="City (optional)"
                        className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                      />
                      <LocationAutocomplete
                        value={orgChoice.address ?? ""}
                        onChange={(v) =>
                          setOrgChoice({ ...orgChoice, address: v, placeId: undefined, geo: null })
                        }
                        onPick={(v, placeId, geo) =>
                          setOrgChoice({
                            ...orgChoice,
                            address: v,
                            placeId,
                            geo: geo ? { lat: geo.lat, lng: geo.lng } : null,
                          })
                        }
                        placeholder="Street address (optional)"
                        mode="place"
                        showCurrentButton={false}
                      />
                      {orgChoice.geo && (
                        <div className="overflow-hidden rounded-2xl border border-border">
                          <VenueMapPreview
                            address={orgChoice.address ?? orgChoice.name}
                            lat={orgChoice.geo.lat}
                            lng={orgChoice.geo.lng}
                            placeId={orgChoice.placeId}
                          />
                        </div>
                      )}

                      <textarea
                        value={orgChoice.bio}
                        onChange={(e) => setOrgChoice({ ...orgChoice, bio: e.target.value })}
                        placeholder="Short bio (optional)"
                        className="w-full min-h-16 rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        You'll be the owner. Handle must be 3–40 chars (a–z, 0–9, _ or -).
                      </p>
                    </div>
                  )}
                </Section>
              )}

              <Section title="Live preview">
                <div className="rounded-3xl border border-lime/30 bg-surface/40 p-3">
                  <OrgCard org={handlePreview} />
                </div>
                <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-lime" /> This is how{" "}
                  {isCoach ? "athletes" : "players"} will see you in feeds.
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
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="rounded-2xl border border-border bg-surface px-5 py-3.5 text-sm font-bold"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={() => nav({ to: backHref })}
              className="rounded-2xl border border-border bg-surface px-5 py-3.5 text-sm font-bold"
            >
              Cancel
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="button"
              disabled={!canNext}
              onClick={() => setStep((s) => s + 1)}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-lime-gradient py-3.5 text-sm font-bold text-primary-foreground glow-lime disabled:opacity-40"
            >
              Continue <ArrowRight className="h-4 w-4" />
            </motion.button>
          ) : (
            <div className="flex-1 flex flex-col gap-1">
              <motion.button
                whileTap={{ scale: 0.98 }}
                type="button"
                onClick={submit}
                disabled={submitting || (isCoach && !!slotsError) || venuesError}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 section-eyebrow text-muted-foreground">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ChipPicker({
  options,
  selected,
  onToggle,
  single = false,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  single?: boolean;
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
      {single && selected.length > 0 && <span className="sr-only">Single-select</span>}
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Users,
  GraduationCap,
  Sparkles,
  X,
  Plus,
} from "lucide-react";
import {
  SPORTS,
  HERO_IMAGE,
  POSITIONS_BY_SPORT,
  type Sport,
  type Org,
  type OrgKind,
} from "@/lib/sample-data";
import { addOrg } from "@/lib/org-store";
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
import { TeamCoverUploader } from "@/components/TeamCoverUploader";
import { PositionsPicker, positionsCleanup, type PositionsNeeded } from "@/components/PositionsPicker";


export const Route = createFileRoute("/teams/create")({
  validateSearch: zodValidator(
    z.object({
      kind: fallback(z.string(), "").default(""),
    }),
  ),
  head: () => ({ meta: [{ title: "Create a profile — OpenRun" }] }),
  component: CreateOrg,
});

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

const STEPS = ["Type", "Identity", "Details", "Branding"] as const;

const SKILL_LABELS = ["Beginner", "Recreational", "Intermediate", "Advanced", "Pro"] as const;


function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function CreateOrg() {
  const nav = useNavigate();
  const { kind: kindParam } = Route.useSearch();
  const initialKind: OrgKind | null =
    kindParam === "coach" || kindParam === "team" ? (kindParam as OrgKind) : null;
  const [step, setStep] = useState(initialKind ? 1 : 0);

  // Form state
  const [kind, setKind] = useState<OrgKind | null>(initialKind);
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
  const [skillMin, setSkillMin] = useState(1); // 1 = Beginner
  const [skillMax, setSkillMax] = useState(3); // 3 = Intermediate

  // Sport-specific extensions
  const [format, setFormat] = useState<string>("");
  const [venues, setVenues] = useState<string[]>([]);
  const [cadence, setCadence] = useState<string>("");
  const [positionsBySport, setPositionsBySport] = useState<Record<string, PositionsNeeded>>({});
  const [ratingMin, setRatingMin] = useState<string>("");
  const [ratingMax, setRatingMax] = useState<string>("");
  const [distances, setDistances] = useState<string[]>([]);
  const [sessionTypes, setSessionTypes] = useState<string[]>([]);

  const primary = primarySport(sports);
  const ratingSystem = ratingSystemFor(primary);
  const ratingLevels = ratingLevelsFor(primary);
  const usesSelfRating = ratingSystem === "SELF";
  const formatOptions = useMemo(() => mergedFormats(sports), [sports]);
  const venueOptions = useMemo(() => mergedVenues(sports), [sports]);
  const cadenceOptions = useMemo(() => mergedCadences(sports), [sports]);
  const credentialPresets = useMemo(() => mergedCredentialPresets(sports), [sports]);
  const showTeamBlocks = kind === "team" && hasTeamSport(sports);
  const showDistances = hasRunning(sports);


  const computedAvatar = avatar || initials(name || "Open Run");

  const canNext = useMemo(() => {
    if (step === 0) return !!kind;
    if (step === 1)
      return (
        name.trim().length > 1 &&
        handle.trim().length > 1 &&
        sports.length > 0 &&
        city.trim().length > 0
      );
    if (step === 2) return bio.trim().length > 10;
    if (step === 3) return true;
    return false;
  }, [step, kind, name, handle, sports, city, bio]);

  const handlePreview: Org = {
    id: "preview",
    kind: kind ?? "team",
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
    roster: kind === "team" ? staff.length : 0,
    bio,
    achievements,
    credentials: kind === "coach" ? credentials : undefined,
    ratePerHour: kind === "coach" ? rate : undefined,
    rating: kind === "coach" ? undefined : undefined,
    reviews: kind === "coach" ? 0 : undefined,
    league: kind === "team" ? league : undefined,
    record: kind === "team" ? { w: wins, l: losses } : undefined,
    homeCourt: kind === "team" ? homeCourt : undefined,
    staff: kind === "team" ? staff : undefined,
    skillRange: { min: skillMin, max: skillMax },
    format: format || undefined,
    venues,
    cadence: cadence || undefined,
    positionsNeeded: Object.fromEntries(
      Object.entries(positionsBySport).map(([k, v]) => [k, positionsCleanup(v)]),
    ),
    ratingSystem,
    ratingMin: ratingMin || undefined,
    ratingMax: ratingMax || undefined,
    distances,
    sessionTypes: kind === "coach" ? sessionTypes : undefined,
    upcoming: [],
    posts: [],
  };




  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function submit() {
    if (submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    const id = `${kind === "team" ? "t" : "c"}-${(name || "org").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36).slice(-4)}`;
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
      nav({ to: "/teams/$teamId", params: { teamId: saved.id } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create team.";
      setSubmitError(
        /unauthor/i.test(msg)
          ? "Please sign in to create a team."
          : msg,
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
    <div className="mx-auto max-w-md px-4 pt-6 pb-32">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link
          to="/teams"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            Step {step + 1} of {STEPS.length}
          </div>
          <h1 className="font-display text-xl font-bold leading-tight">{STEPS[step]}</h1>
        </div>
      </div>

      {/* Progress */}
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
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground mb-2">Who is this profile for?</p>
              <TypeCard
                active={kind === "team"}
                onClick={() => setKind("team")}
                icon={<Users className="h-6 w-6" />}
                title="Team / Club"
                desc="Run a roster, post tryouts, schedule pickups, share recaps."
                badges={["Tryouts", "League play", "Roster"]}
              />
              <TypeCard
                active={kind === "coach"}
                onClick={() => setKind("coach")}
                icon={<GraduationCap className="h-6 w-6" />}
                title="Trainer"
                desc="Showcase credentials, book sessions, run clinics & open workouts."
                badges={["Clinics", "Bookings", "Reviews"]}
              />
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <Section title={kind === "team" ? "Team name" : "Trainer name"}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={kind === "team" ? "Eastside Elite" : "Trainer Jordan Kim"}
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
                <Section title="Preferred format">
                  <ChipPicker
                    options={formatOptions}
                    selected={format ? [format] : []}
                    onToggle={(v) => setFormat((cur) => (cur === v ? "" : v))}
                    single
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
                    selected={cadence ? [cadence] : []}
                    onToggle={(v) => setCadence((cur) => (cur === v ? "" : v))}
                    single
                  />
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
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
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
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
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
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Min</div>
                        <select
                          value={ratingMin}
                          onChange={(e) => setRatingMin(e.target.value)}
                          className="w-full bg-transparent text-sm font-bold outline-none"
                        >
                          <option value="">—</option>
                          {ratingLevels.map((l) => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                        </select>
                      </label>
                      <label className="rounded-xl border border-border bg-background/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Max</div>
                        <select
                          value={ratingMax}
                          onChange={(e) => setRatingMax(e.target.value)}
                          className="w-full bg-transparent text-sm font-bold outline-none"
                        >
                          <option value="">—</option>
                          {ratingLevels.map((l) => (
                            <option key={l} value={l}>{l}</option>
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

          {step === 2 && (
            <div className="space-y-5">
              <Section title="Bio">
                <textarea
                  rows={5}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={
                    kind === "team"
                      ? "Tell players who you are, your vibe, and what kind of athletes thrive here."
                      : "Tell athletes about your background, coaching philosophy, and who you work best with."
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

              {kind === "team" && (
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
                    <input
                      value={homeCourt}
                      onChange={(e) => setHomeCourt(e.target.value)}
                      placeholder="Tompkins Square Courts"
                      className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                    />
                  </Section>

                  <Section title="Record (optional)">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="rounded-2xl border border-border bg-surface px-4 py-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
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
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
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
                        onChange={(next) =>
                          setPositionsBySport((cur) => ({ ...cur, [s]: next }))
                        }
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

              {kind === "coach" && (
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

          {step === 3 && (
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

              <Section title="Avatar initials">
                <input
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value.toUpperCase().slice(0, 3))}
                  placeholder={initials(name || "OR")}
                  maxLength={3}
                  className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-center font-display text-2xl font-bold uppercase tracking-widest outline-none focus:border-lime"
                />
                <p className="text-[10px] text-muted-foreground text-center mt-1">
                  Auto-generated from your name — edit if you like.
                </p>
              </Section>

              <Section title="Team photo">
                <TeamCoverUploader
                  cover={cover}
                  onCoverChange={setCover}
                  isCustom={customCover}
                  onCustomChange={setCustomCover}
                  fallback={HERO_IMAGE}
                />
              </Section>


              <Section title="Live preview">
                <div className="rounded-3xl border border-lime/30 bg-surface/40 p-3">
                  <OrgCard org={handlePreview} />
                </div>
                <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-lime" /> This is how players will see you in
                  feeds.
                </div>
              </Section>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Footer nav */}
      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+6rem)] left-0 right-0 z-30 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 bg-gradient-to-t from-background via-background/90 to-transparent">
        <div className="mx-auto max-w-md flex gap-2">
          {step > 0 && !(initialKind && step === 1) && (
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(initialKind ? 1 : 0, s - 1))}
              className="rounded-2xl border border-border bg-surface px-5 py-3.5 text-sm font-bold"
            >
              Back
            </button>
          )}
          {initialKind && step === 1 && (
            <button
              type="button"
              onClick={() => nav({ to: initialKind === "coach" ? "/trainers" : "/teams" })}
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

function TypeCard({
  active,
  onClick,
  icon,
  title,
  desc,
  badges,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  badges: string[];
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`block w-full text-left rounded-3xl border-2 p-5 transition-all ${
        active
          ? "border-lime bg-lime/10 glow-lime"
          : "border-border bg-surface hover:border-lime/40"
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${active ? "bg-lime text-primary-foreground" : "bg-secondary text-foreground"}`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-bold">{title}</h3>
            {active && <Check className="h-4 w-4 text-lime" />}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{desc}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {badges.map((b) => (
              <span
                key={b}
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${active ? "bg-background/40 text-foreground" : "bg-secondary text-muted-foreground"}`}
              >
                {b}
              </span>
            ))}
          </div>
        </div>
      </div>
    </motion.button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
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
      {single && selected.length > 0 && (
        <span className="sr-only">Single-select</span>
      )}
    </div>
  );
}


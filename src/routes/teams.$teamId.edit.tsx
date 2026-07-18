import { createFileRoute, Link, useNavigate, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
  X,
  Plus,
  ChevronUp,
  ChevronDown,
  Trash2,
} from "lucide-react";
import { SPORTS, HERO_IMAGE, type Sport, type Org } from "@/lib/sample-data";
import { getOrgById, updateOrg, deleteOrg, isMyOrg } from "@/lib/org-store";
import { OrgCard } from "@/components/OrgCard";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { TeamCoverUploader } from "@/components/TeamCoverUploader";


export const Route = createFileRoute("/teams/$teamId/edit")({
  head: ({ params }) => {
    const o = getOrgById(params.teamId);
    return { meta: [{ title: o ? `Edit ${o.name} — OpenRun` : "Edit — OpenRun" }] };
  },
  component: EditOrg,
  notFoundComponent: () => (
    <div className="mx-auto max-w-md px-6 pt-24 text-center">
      <p className="text-muted-foreground">Organization not found.</p>
      <Link
        to="/teams"
        className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
      >
        Back to Teams
      </Link>
    </div>
  ),
  loader: ({ params }) => {
    const org = getOrgById(params.teamId);
    if (!org) throw notFound();
    return org;
  },
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

const STEPS = ["Identity", "Details", "Branding"] as const;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function EditOrg() {
  const org = Route.useLoaderData() as Org;
  const nav = useNavigate();
  const [step, setStep] = useState(1);

  // Pre-fill form state
  const [name, setName] = useState(org.name);
  const [handle, setHandle] = useState(org.handle.replace("@", ""));
  const [tagline, setTagline] = useState(org.tagline);
  const [city, setCity] = useState(org.city);
  const [founded, setFounded] = useState(org.founded);
  const [sports, setSports] = useState<Sport[]>(org.sports);
  const [bio, setBio] = useState(org.bio);
  const [achievements, setAchievements] = useState<string[]>(org.achievements);
  const [achInput, setAchInput] = useState("");
  // Team-only
  const [league, setLeague] = useState(org.league ?? "");
  const [homeCourt, setHomeCourt] = useState(org.homeCourt ?? "");
  const [wins, setWins] = useState(org.record?.w ?? 1);
  const [losses, setLosses] = useState(org.record?.l ?? 0);
  const [staff, setStaff] = useState<{ name: string; role: string; avatar: string }[]>(
    org.staff ?? [],
  );
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState("");
  // Coach-only
  const [credentials, setCredentials] = useState<string[]>(org.credentials ?? []);
  const [credInput, setCredInput] = useState("");
  const [rate, setRate] = useState(org.ratePerHour ?? 75);
  // Branding
  const [accent, setAccent] = useState(org.accent);
  const [avatar, setAvatar] = useState(org.avatar);
  const [cover, setCover] = useState<string>(org.cover);
  const [customCover, setCustomCover] = useState<boolean>(() => {
    const c = org.cover;
    // Uploaded photos live at Supabase Storage URLs or as data URLs; presets are bundled asset URLs.
    return /\/storage\/v1\//.test(c) || c.startsWith("data:") || c.startsWith("blob:");
  });


  const canNext = useMemo(() => {
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
  }, [step, name, handle, sports, city, bio]);

  if (!isMyOrg(org.id)) {
    return (
      <div className="mx-auto max-w-md px-6 pt-24 text-center">
        <p className="text-muted-foreground">You can only edit organizations you created.</p>
        <Link
          to="/teams/$teamId"
          params={{ teamId: org.id }}
          className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
        >
          Back to profile
        </Link>
      </div>
    );
  }

  const kind = org.kind;
  const computedAvatar = avatar || initials(name || "OR");

  const handlePreview: Org = {
    ...org,
    name: name || org.name,
    handle: handle.startsWith("@") ? handle : `@${handle || org.handle.slice(1)}`,
    tagline: tagline || org.tagline,
    city: city || org.city,
    founded,
    sports: sports.length ? sports : org.sports,
    cover,
    avatar: computedAvatar,
    accent,
    bio,
    achievements,
    credentials: kind === "coach" ? credentials : undefined,
    ratePerHour: kind === "coach" ? rate : undefined,
    league: kind === "team" ? league : undefined,
    record: kind === "team" ? { w: wins, l: losses } : undefined,
    homeCourt: kind === "team" ? homeCourt : undefined,
    staff: kind === "team" ? staff : undefined,
  };

  function save() {
    const handleClean = (handle.startsWith("@") ? handle.slice(1) : handle)
      .replace(/[^a-zA-Z0-9_]/g, "")
      .toLowerCase();
    updateOrg(org.id, {
      name,
      handle: `@${handleClean || org.handle.slice(1)}`,
      tagline,
      city,
      founded,
      sports,
      cover,
      avatar: computedAvatar,
      accent,
      bio,
      achievements,
      credentials: kind === "coach" ? credentials : undefined,
      ratePerHour: kind === "coach" ? rate : undefined,
      league: kind === "team" ? league : undefined,
      record: kind === "team" ? { w: wins, l: losses } : undefined,
      homeCourt: kind === "team" ? homeCourt : undefined,
      staff: kind === "team" ? staff : undefined,
      roster: kind === "team" ? staff.length : org.roster,
    });
    nav({ to: "/teams/$teamId", params: { teamId: org.id } });
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
  function moveStaff(i: number, dir: -1 | 1) {
    setStaff((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function handleDelete() {
    if (!confirm(`Delete ${org.name}? This cannot be undone.`)) return;
    deleteOrg(org.id);
    nav({ to: "/teams" });
  }

  function toggleSport(s: Sport) {
    setSports((arr) => (arr.includes(s) ? arr.filter((x) => x !== s) : [...arr, s]));
  }

  return (
    <div className="mx-auto max-w-md px-4 pt-6 pb-32">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link
          to="/teams/$teamId"
          params={{ teamId: org.id }}
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            Step {step} of {STEPS.length}
          </div>
          <h1 className="font-display text-xl font-bold leading-tight">{STEPS[step - 1]}</h1>
        </div>
        <div className="rounded-full bg-secondary px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {kind === "team" ? "Team" : "Coach"}
        </div>
      </div>

      {/* Progress */}
      <div className="flex gap-1.5 mb-6">
        {STEPS.map((_, i) => (
          <div key={i} className="h-1 flex-1 rounded-full overflow-hidden bg-secondary">
            <motion.div
              initial={false}
              animate={{ width: i + 1 <= step ? "100%" : "0%" }}
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
          {step === 1 && (
            <div className="space-y-5">
              <Section title={kind === "team" ? "Team name" : "Coach name"}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={kind === "team" ? "Eastside Elite" : "Coach Jordan Kim"}
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
                            <div className="flex flex-col">
                              <button
                                type="button"
                                onClick={() => moveStaff(i, -1)}
                                disabled={i === 0}
                                className="text-muted-foreground hover:text-lime disabled:opacity-20"
                              >
                                <ChevronUp className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveStaff(i, 1)}
                                disabled={i === staff.length - 1}
                                className="text-muted-foreground hover:text-lime disabled:opacity-20"
                              >
                                <ChevronDown className="h-4 w-4" />
                              </button>
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
                              className="text-muted-foreground hover:text-coral ml-1"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </Section>
                </>
              )}

              {kind === "coach" && (
                <>
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

              <Section title="Cover image">
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      "Basketball",
                      "Soccer",
                      "Tennis",
                      "Volleyball",
                      "Pickleball",
                      "Running",
                    ] as Sport[]
                  ).map((s) => {
                    const src = imageFor(s);
                    const active = cover === src;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setCover(src)}
                        className={`relative aspect-video overflow-hidden rounded-xl border-2 transition-all ${
                          active ? "border-lime" : "border-transparent opacity-70 hover:opacity-100"
                        }`}
                      >
                        <img src={src} alt="" className="h-full w-full object-cover" />
                        {active && (
                          <span className="absolute inset-0 bg-lime/20 grid place-items-center">
                            <Check className="h-5 w-5 text-lime" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface/40 py-3 text-sm font-semibold text-muted-foreground hover:border-lime hover:text-lime">
                  <Upload className="h-4 w-4" /> Upload custom cover
                  <input type="file" accept="image/*" onChange={onCoverUpload} className="hidden" />
                </label>
                {cover.startsWith("data:") && (
                  <div className="mt-2 relative aspect-video overflow-hidden rounded-xl border-2 border-lime">
                    <img src={cover} alt="" className="h-full w-full object-cover" />
                    <span className="absolute top-1.5 left-1.5 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                      Custom
                    </span>
                  </div>
                )}
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

              <div className="pt-4 mt-4 border-t border-border">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-coral/40 bg-coral/10 py-3 text-sm font-bold text-coral hover:bg-coral/20"
                >
                  <Trash2 className="h-4 w-4" /> Delete organization
                </button>
                <p className="text-[11px] text-muted-foreground text-center mt-2">
                  Permanently removes this profile and its posts.
                </p>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Footer nav */}
      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+6rem)] left-0 right-0 z-30 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 bg-gradient-to-t from-background via-background/90 to-transparent">
        <div className="mx-auto max-w-md flex gap-2">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="rounded-2xl border border-border bg-surface px-5 py-3.5 text-sm font-bold"
            >
              Back
            </button>
          )}
          {step < STEPS.length ? (
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
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={save}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-coral-gradient py-3.5 text-sm font-bold text-white glow-coral"
            >
              <Sparkles className="h-4 w-4" /> Save changes
            </motion.button>
          )}
        </div>
      </div>
    </div>
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

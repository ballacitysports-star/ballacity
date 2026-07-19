import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Sparkles, X, Plus } from "lucide-react";
import {
  SPORTS,
  HERO_IMAGE,
  type Sport,
  type Org,
} from "@/lib/sample-data";
import { addOrg } from "@/lib/org-store";
import { SESSION_TYPES } from "@/lib/sport-config";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { VenueMapPreview } from "@/components/VenueMapPreview";
import { OrgCard } from "@/components/OrgCard";

import { WeeklyQuickPick } from "@/components/create/WeeklyQuickPick";
import { AvailabilityConfirm } from "@/components/create/AvailabilityConfirm";
import { loadDraft, useDraftPersistence } from "@/components/create/useDraftPersistence";
import { toast } from "sonner";

const STEP_LABELS = ["Basics", "Expertise", "Where", "Availability", "Confirm"] as const;
const SKILL_LABELS = ["Beginner", "Recreational", "Intermediate", "Advanced", "Pro"] as const;

type Slot = { day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"; start: string; end: string; venue?: string };

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
  credentials: string[];
  venue: string;
  venuePlaceId: string;
  venueGeo: { lat: number; lng: number } | null;
  slots: Slot[];
  overrides: { date: string; closed?: boolean; windows?: { start: string; end: string; venue?: string }[] }[];
  timezone: string;
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
    credentials: [],
    venue: "",
    venuePlaceId: "",
    venueGeo: null,
    slots: [],
    overrides: [],
    timezone: defaultTimezone(),
  };
}

export function CreateTrainerWizard() {
  const nav = useNavigate();

  const [draft, setDraft] = useState<Draft>(() => {
    if (typeof window === "undefined") return initialDraft();
    const stored = loadDraft<Draft>(DRAFT_KEY);
    return stored ? { ...initialDraft(), ...stored } : initialDraft();
  });
  const [credInput, setCredInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const { clear: clearDraft } = useDraftPersistence(DRAFT_KEY, draft);

  useEffect(() => {
    const stored = loadDraft<Draft>(DRAFT_KEY);
    if (stored && (stored.name || stored.bio || stored.venue)) {
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
    () => (draft.primarySport ? [draft.primarySport, ...draft.extraSports.filter((s) => s !== draft.primarySport)] : []),
    [draft.primarySport, draft.extraSports],
  );

  const bioOk = draft.bio.trim().length >= 40;
  const venueOk = !!draft.venue.trim() && !!draft.venuePlaceId;

  const canNext = useMemo(() => {
    if (step === 0)
      return draft.name.trim().length > 1 && draft.handle.trim().length > 1 && !!draft.primarySport && draft.city.trim().length > 0;
    if (step === 1) return bioOk;
    if (step === 2) return venueOk;
    return true;
  }, [step, draft, bioOk, venueOk]);

  const canSkip = step === 1 || step === 3 || step === 4;

  const previewOrg: Org = {
    id: "preview",
    kind: "coach",
    name: draft.name || "Your trainer profile",
    handle: draft.handle.startsWith("@") ? draft.handle : `@${draft.handle || "handle"}`,
    tagline: draft.tagline || (draft.primarySport ? `${draft.primarySport} trainer` : "Add a short tagline"),
    city: draft.city || "Your city",
    founded: new Date().getFullYear(),
    sports: sports.length ? sports : (["Basketball"] as Sport[]),
    verified: false,
    cover: HERO_IMAGE,
    avatar: initials(draft.name || "OR"),
    accent: "#a3ff12",
    followers: 0,
    roster: 0,
    bio: draft.bio,
    achievements: [],
    credentials: draft.credentials,
    ratePerHour: draft.rate,
    skillRange: { min: draft.skillMin, max: draft.skillMax },
    sessionTypes: draft.sessionTypes,
    venueAddresses: draft.venue ? [draft.venue] : [],
    verifiedVenues: draft.venue && draft.venuePlaceId ? [draft.venue.toLowerCase()] : [],
    venueGeo:
      draft.venue && draft.venuePlaceId && draft.venueGeo
        ? [
            {
              address: draft.venue,
              placeId: draft.venuePlaceId,
              lat: draft.venueGeo.lat,
              lng: draft.venueGeo.lng,
            },
          ]
        : [],
    primaryVenue: draft.venue || undefined,
    availabilitySlots: draft.slots,
    availabilityOverrides: draft.overrides,
    timezone: draft.timezone,
    upcoming: [],
    posts: [],
  };

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const id = `c-${(draft.name || "trainer").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36).slice(-4)}`;
    const handleClean = draft.handle.replace(/^@/, "").replace(/[^a-z0-9_]/gi, "").toLowerCase();
    const org: Org = {
      ...previewOrg,
      id,
      handle: `@${handleClean || "trainer"}`,
    };
    try {
      const saved = await addOrg(org);
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
    <div className="mx-auto max-w-md px-4 pt-6 pb-32">
      <div className="flex items-center gap-3 mb-4">
        <Link
          to="/trainers"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            Step {step + 1} of {STEP_LABELS.length} · {STEP_LABELS[step]}
          </div>
          <h1 className="font-display text-xl font-bold leading-tight">
            {step === 0 && "The basics"}
            {step === 1 && "Your expertise"}
            {step === 2 && "Where you train"}
            {step === 3 && "When you're available"}
            {step === 4 && "Confirm your schedule"}
          </h1>
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
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Min</div>
                      <select
                        value={draft.skillMin}
                        onChange={(e) => {
                          const v = +e.target.value;
                          setDraft((d) => ({ ...d, skillMin: v, skillMax: Math.max(v, d.skillMax) }));
                        }}
                        className="w-full bg-transparent text-sm font-bold outline-none"
                      >
                        {SKILL_LABELS.map((l, i) => (
                          <option key={l} value={i + 1}>{l}</option>
                        ))}
                      </select>
                    </label>
                    <label className="rounded-xl border border-border bg-background/60 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Max</div>
                      <select
                        value={draft.skillMax}
                        onChange={(e) => {
                          const v = +e.target.value;
                          setDraft((d) => ({ ...d, skillMax: v, skillMin: Math.min(v, d.skillMin) }));
                        }}
                        className="w-full bg-transparent text-sm font-bold outline-none"
                      >
                        {SKILL_LABELS.map((l, i) => (
                          <option key={l} value={i + 1}>{l}</option>
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
                title="Primary venue"
                hint="Pick from Google suggestions so we can pin it on the map. Add more venues later from your profile."
              >
                <LocationAutocomplete
                  value={draft.venue}
                  onChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      venue: v,
                      // Invalidate verification when free-typed.
                      venuePlaceId: v.trim().toLowerCase() === d.venue.trim().toLowerCase() ? d.venuePlaceId : "",
                      venueGeo: v.trim().toLowerCase() === d.venue.trim().toLowerCase() ? d.venueGeo : null,
                    }))
                  }
                  onPick={(full, placeId, geo) =>
                    setDraft((d) => ({
                      ...d,
                      venue: full,
                      venuePlaceId: placeId,
                      venueGeo: geo ? { lat: geo.lat, lng: geo.lng } : null,
                    }))
                  }
                  placeholder="Start typing then pick a Google suggestion"
                />
                {draft.venue && !draft.venuePlaceId && (
                  <p className="text-[11px] text-coral">
                    Pick a suggestion from the dropdown so we can verify the address.
                  </p>
                )}
                {draft.venuePlaceId && (
                  <div className="flex items-center gap-2 text-[11px] text-lime">
                    <Check className="h-3 w-3" /> Verified
                  </div>
                )}
                {draft.venue && draft.venuePlaceId && draft.venueGeo && (
                  <VenueMapPreview
                    address={draft.venue}
                    lat={draft.venueGeo.lat}
                    lng={draft.venueGeo.lng}
                    placeId={draft.venuePlaceId}
                  />
                )}
              </Section>

              <p className="text-[12px] text-muted-foreground">
                Timezone auto-detected: <span className="text-foreground font-semibold">{draft.timezone}</span>
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <Section title="Weekly template">
                <WeeklyQuickPick
                  value={draft.slots}
                  onChange={(slots) => setDraft((d) => ({ ...d, slots }))}
                />
              </Section>

              <Section title="Live preview">
                <div className="rounded-3xl border border-lime/30 bg-surface/40 p-3">
                  <OrgCard org={previewOrg} />
                </div>
                <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-lime" /> This is how athletes will see you in feeds.
                </div>
              </Section>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              {draft.slots.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-surface/60 p-5 text-center text-sm text-muted-foreground">
                  No weekly template yet. Go back and pick one, or skip — you can manage availability later.
                </div>
              ) : (
                <AvailabilityConfirm
                  slots={draft.slots}
                  overrides={draft.overrides}
                  timezone={draft.timezone}
                  onChangeOverrides={(o) => setDraft((d) => ({ ...d, overrides: o }))}
                  onChangeTimezone={(tz) => setDraft((d) => ({ ...d, timezone: tz }))}
                />
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+6rem)] left-0 right-0 z-30 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 bg-gradient-to-t from-background via-background/90 to-transparent">
        <div className="mx-auto max-w-md flex gap-2">
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
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</div>
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
              active ? "border-lime bg-lime/10 text-lime" : "border-border bg-surface text-muted-foreground hover:border-lime/40"
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

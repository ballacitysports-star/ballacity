import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useAccountType, type AccountType } from "@/lib/account-type";
import {
  getFeedPrefsSnapshot,
  setFeedPrefs,
  setProfileOverrides,
  useMyProfileState,
  useDistanceUnit,
  type ProfileLink,
} from "@/lib/user-prefs-store";
import { clampDistanceMi, kmToMi, miToKm } from "@/lib/distance";
import { ProfileLocationFields } from "@/components/profile/ProfileLocationFields";
import { Section, validateBirthday } from "@/components/profile/ProfileFormPrimitives";
import { birthdayRequiresParentalConsent } from "@/lib/age-policy";
import {
  ProfileBasicsFields,
  type ProfileBasicsValue,
} from "@/components/profile/ProfileBasicsFields";
import { ProfileSportsFields, type SportEntry } from "@/components/profile/ProfileSportsFields";
import {
  ProfileLinksFields,
  cleanProfileLinks,
  validateProfileUrl,
} from "@/components/profile/ProfileLinksFields";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveStatus } from "@/components/SaveStatus";

const searchSchema = z.object({
  type: z.enum(["player", "team", "trainer", "gym"]).optional(),
});

export const Route = createFileRoute("/onboarding/welcome")({
  head: () =>
    pageHead({
      path: "/onboarding/welcome",
      title: "Set up your profile — ballaCity",
      description:
        "Add your sports, skill levels, location, and availability to finish setting up ballaCity.",
      noindex: true,
    }),
  validateSearch: searchSchema,
  component: OnboardingWelcomePage,
});

type NextStep = { title: string; body: string };

const NEXT_STEPS: Record<
  Exclude<AccountType, "player">,
  { title: string; steps: NextStep[]; cta: string; goto: string }
> = {
  team: {
    title: "Set up your team",
    cta: "Create team profile",
    goto: "/teams/create",
    steps: [
      {
        title: "Team profile",
        body: "Name, sport, colors, and a cover image so players recognize you.",
      },
      { title: "Roster & positions", body: "Add players and mark open spots you need to fill." },
      { title: "Host your first game", body: "Publish pickups, tryouts, or practices in seconds." },
    ],
  },
  trainer: {
    title: "Set up your trainer profile",
    cta: "Create trainer profile",
    goto: "/trainers/create",
    steps: [
      {
        title: "Your sport & credentials",
        body: "Pick a primary sport, add certifications, and describe your style.",
      },
      {
        title: "Venues & availability",
        body: "Add locations and weekly windows so athletes can book you.",
      },
      {
        title: "Accept sessions",
        body: "Approve or decline requests and message athletes directly.",
      },
    ],
  },
  gym: {
    title: "Set up your gym",
    cta: "Create gym profile",
    goto: "/orgs/create",
    steps: [
      { title: "Gym profile", body: "Name, address, and photos so members can find you." },
      { title: "Invite trainers", body: "Link the trainers who run sessions at your gym." },
      { title: "Publish programs", body: "Post clinics, camps, and open runs to your community." },
    ],
  },
};

function OnboardingWelcomePage() {
  const nav = useNavigate();
  const { type: typeFromSearch } = Route.useSearch();
  const { user, loading: authLoading } = useAuth();
  const { accountType, loading: typeLoading } = useAccountType();
  const type: AccountType | null = typeFromSearch ?? accountType;

  useEffect(() => {
    if (authLoading) return;
    if (!user) nav({ to: "/auth" });
  }, [user, authLoading, nav]);

  if (authLoading || typeLoading || !type) return null;

  return <OnboardingWizard type={type} />;
}

type GeoState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "granted"; lat: number; lng: number; accuracy: number }
  | { kind: "denied"; message: string; canRetry: boolean }
  | { kind: "unavailable"; message: string };

function OnboardingWizard({ type }: { type: AccountType }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const { profile, loaded: profileLoaded } = useMyProfileState(user);
  const queryClient = useQueryClient();

  const isPlayer = type === "player";
  const nextCfg = isPlayer ? null : NEXT_STEPS[type as Exclude<AccountType, "player">];

  // Links are optional, so they live inside the Basics step behind a
  // disclosure rather than costing everyone a whole step of their own.
  const stepLabels = isPlayer
    ? ["Basics", "Sports", "Location"]
    : ["Basics", "Sports", "Location", "Next steps"];
  const locationStep = stepLabels.indexOf("Location");


  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const [birthdayError, setBirthdayError] = useState<string | null>(null);

  const [basics, setBasics] = useState<ProfileBasicsValue>({
    name: "",
    username: "",
    avatar: "",
    avatarUrl: undefined,
    coverUrl: undefined,
    city: "",
    bio: "",
    birthday: "",
    graduatingClass: "",
  });
  const [sports, setSports] = useState<SportEntry[]>([]);
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [radius, setRadius] = useState(15); // kilometers (canonical)
  const unit = useDistanceUnit();
  // Radius controls share the app-wide 12,500 mi ceiling.
  const radiusMi = clampDistanceMi(Math.max(1, kmToMi(radius))) as number;
  const [geo, setGeo] = useState<GeoState>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);

  // Idempotency guards: one in-flight save at a time, plus the fingerprint of
  // the last row we successfully persisted for this user.
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const savedFingerprintRef = useRef<string | null>(null);

  // Prefill from the same profile store Edit profile uses so returning users edit
  // rather than re-enter. We wait for `profileLoaded` because until the saved row
  // resolves the store returns auth-derived fallbacks (email local-part as name,
  // no sports) that would overwrite real data.
  useEffect(() => {
    if (!profile || !profileLoaded || prefilled) return;
    setBasics({
      name: profile.name ?? "",
      username: profile.username ?? "",
      avatar: profile.avatar ?? "",
      avatarUrl: profile.avatarUrl,
      coverUrl: profile.coverUrl,
      city: profile.city ?? "",
      bio: profile.bio ?? "",
      birthday: profile.birthday ?? "",
      graduatingClass: profile.graduatingClass != null ? String(profile.graduatingClass) : "",
    });
    setSports((profile.sports ?? []) as SportEntry[]);
    setLinks(profile.links ?? []);
    // Saved profile radius wins over the local default from a previous device.
    if (profile.searchRadiusMi != null) {
      setRadius(miToKm(profile.searchRadiusMi));
    } else {
      try {
        const r = Number(localStorage.getItem("openrun.default_radius_km"));
        if (Number.isFinite(r) && r > 0) setRadius(r);
      } catch {
        /* ignore */
      }
    }

    setPrefilled(true);
  }, [profile, profileLoaded, prefilled]);

  const requestLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeo({
        kind: "unavailable",
        message:
          "Your browser doesn't support location. You can still set your radius manually below.",
      });
      return;
    }
    setGeo({ kind: "requesting" });
    setAttempt((a) => a + 1);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          kind: "granted",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        toast.success("Location set");
      },
      (err) => {
        if (err.code === 1) {
          setGeo({
            kind: "denied",
            message:
              "Location is blocked. Open your browser's site settings for ballaCity, allow Location, then try again — or skip and set a radius manually below.",
            canRetry: true,
          });
        } else if (err.code === 2) {
          setGeo({
            kind: "denied",
            message:
              "We couldn't determine your position. Check your connection or GPS and try again.",
            canRetry: true,
          });
        } else if (err.code === 3) {
          setGeo({
            kind: "denied",
            message: "The location request timed out. Try again from a spot with a better signal.",
            canRetry: true,
          });
        } else {
          setGeo({
            kind: "denied",
            message: err.message || "Something went wrong requesting your location.",
            canRetry: true,
          });
        }
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  };

  useEffect(() => {
    if (geo.kind !== "granted") return;
    try {
      localStorage.setItem("openrun.home_coords", JSON.stringify({ lat: geo.lat, lng: geo.lng }));
    } catch {
      /* ignore */
    }
  }, [geo]);

  const runSave = async () => {
    if (!user) {
      toast.error("Sign in to save");
      return false;
    }
    const trimmedName = basics.name.trim().slice(0, 60);
    if (!trimmedName) {
      toast.error("Name is required");
      setStep(0);
      return false;
    }
    const birthdayErr = validateBirthday(basics.birthday);
    if (birthdayErr) {
      setBirthdayError(birthdayErr);
      toast.error(birthdayErr);
      setStep(0);
      return false;
    }
    const birthdayClean =
      basics.birthday && /^\d{4}-\d{2}-\d{2}$/.test(basics.birthday) ? basics.birthday : undefined;
    const gradNum = basics.graduatingClass.trim() ? parseInt(basics.graduatingClass, 10) : NaN;
    const currentYear = new Date().getFullYear();
    const gradClean =
      Number.isFinite(gradNum) && gradNum >= 1950 && gradNum <= currentYear + 15
        ? gradNum
        : undefined;
    if (basics.graduatingClass.trim() && gradClean === undefined) {
      toast.error("Graduating class must be a valid year");
      setStep(0);
      return false;
    }
    const { validateProfileSafety } = await import("@/lib/profile-payload");
    const safetyErr = validateProfileSafety({
      username: basics.username,
      name: trimmedName,
      birthday: birthdayClean,
    });
    if (safetyErr) {
      toast.error(safetyErr);
      setStep(0);
      return false;
    }
    const trimmedCity = basics.city.trim().slice(0, 80);
    const initials = (basics.avatar.trim() || trimmedName.slice(0, 2)).toUpperCase().slice(0, 3);
    if (links.some((l) => validateProfileUrl(l.url) !== null)) {
      toast.error("Fix your profile links");
      setStep(2);
      return false;
    }
    const cleanedLinks = cleanProfileLinks(links);

    setSaving(true);
    try {
      setProfileOverrides(user.id, {
        name: trimmedName,
        username: basics.username.trim().slice(0, 30),
        avatar: initials,
        avatarUrl: basics.avatarUrl,
        coverUrl: basics.coverUrl,
        city: trimmedCity,
        bio: basics.bio.trim().slice(0, 280),
        birthday: birthdayClean,
        graduatingClass: gradClean,
        sports,
        links: cleanedLinks,
      });

      const { supabase } = await import("@/integrations/supabase/client");
      const { buildProfileRow, profileRowFingerprint, onboardingSaveKey, saveProfileRow } =
        await import("@/lib/profile-payload");

      const primary = sports[0]?.name;
      const row = buildProfileRow({
        searchRadiusMi: radiusMi,
        userId: user.id,
        name: trimmedName,
        username: basics.username,
        avatarInitials: initials,
        bio: basics.bio,
        city: trimmedCity,
        avatarUrl: basics.avatarUrl,
        coverUrl: basics.coverUrl,
        birthday: birthdayClean,
        graduatingClass: gradClean,
        sports,
        links: cleanedLinks,
      });

      // Idempotency: skip the write entirely when this exact row was already
      // saved for this user (double taps, retries after a remount, back/next).
      const fingerprint = profileRowFingerprint(row);
      let alreadySaved = savedFingerprintRef.current === fingerprint;
      if (!alreadySaved) {
        try {
          alreadySaved = localStorage.getItem(onboardingSaveKey(user.id)) === fingerprint;
        } catch {
          /* ignore */
        }
      }

      if (!alreadySaved) {
        // Keyed on the primary key, so a retry updates the same row and can
        // never insert a second profile for this user.
        await saveProfileRow(supabase, row);
        savedFingerprintRef.current = fingerprint;
        try {
          localStorage.setItem(onboardingSaveKey(user.id), fingerprint);
        } catch {
          /* ignore */
        }
      }

      try {
        localStorage.setItem("openrun.default_radius_km", String(radius));
      } catch {
        /* ignore */
      }

      const current = getFeedPrefsSnapshot();
      setFeedPrefs({
        ...current,
        preferredSports: Array.from(
          new Set([...sports.map((s) => s.name), ...current.preferredSports]),
        ),
        // `maxDistanceMi` is always stored in miles; `radius` is kilometers.
        maxDistanceMi: radiusMi,
      });

      await queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey?.[0];
          return (
            typeof k === "string" &&
            (k.startsWith("feed") || k.startsWith("games") || k === "profile" || k === "me")
          );
        },
      });
      try {
        window.dispatchEvent(
          new CustomEvent("openrun:prefs-updated", {
            detail: { sport: primary, radiusKm: radius },
          }),
        );
      } catch {
        /* ignore */
      }
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save your profile");
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Collapses concurrent submissions (double taps, retry while pending) into a
  // single in-flight save.
  const save = () => {
    if (inFlightRef.current) return inFlightRef.current;
    const p = runSave().finally(() => {
      inFlightRef.current = null;
    });
    inFlightRef.current = p;
    return p;
  };

  const autosave = useAutosave({
    value: { basics, sports, links, radius },
    // Only after prefill so the debounce can't write placeholder values back
    // over the saved profile row.
    enabled: !!user && prefilled,
    validate: () => {
      if (!basics.name.trim()) return "name is required";
      const err = validateBirthday(basics.birthday);
      if (err) return err.toLowerCase();
      if (links.some((l) => validateProfileUrl(l.url) !== null)) return "fix your profile links";
      return null;
    },
    save: async () => {
      const ok = await save();
      if (!ok) throw new Error("Couldn't save your profile");
    },
  });

  const isLast = step === stepLabels.length - 1;

  const onNext = async () => {
    // Save once the profile steps are complete (before location/next-steps handoff).
    if (step === locationStep) {
      const ok = await save();
      if (!ok) return;
    }

    if (isLast) {
      // Under-13 members finish in the parental-consent flow, not the feed.
      if (birthdayRequiresParentalConsent(basics.birthday)) {
        nav({ to: "/onboarding/child" });
        return;
      }
      if (nextCfg) nav({ to: nextCfg.goto, search: { finish: 1 } as never });
      else nav({ to: "/feed" });
      return;
    }
    setStep((s) => s + 1);
  };

  const pct = Math.round(((step + 1) / stepLabels.length) * 100);

  return (
    <div className="page-shell-narrow flex min-h-dvh flex-col py-8">
      <div>
        <div className="font-display text-2xl font-bold">Set up your profile</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Same details as Edit profile — you can change any of it later.
        </p>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>
            Step {step + 1} of {stepLabels.length} · {stepLabels[step]}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="mt-1.5">
          <SaveStatus {...autosave} variant="pill" />
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface">
          <div
            className="h-full bg-lime-gradient transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {step === 0 && (
        <Section title="Basics">
          <ProfileBasicsFields
            userId={user?.id}
            value={basics}
            birthdayError={birthdayError}
            onChange={(patch) => {
              setBasics((b) => ({ ...b, ...patch }));
              if ("birthday" in patch) setBirthdayError(validateBirthday(patch.birthday ?? ""));
            }}
          />
        </Section>
      )}

      {step === 1 && (
        <Section title="Sports">
          <ProfileSportsFields sports={sports} onChange={setSports} />
        </Section>
      )}

      {step === 2 && (
        <Section title="Profile links">
          <ProfileLinksFields links={links} onChange={setLinks} />
        </Section>
      )}

      {step === locationStep && (
        <Section title="Location">
          <p className="mb-3 text-xs text-muted-foreground">
            We use your location to show nearby games. You can also skip and set a radius manually.
          </p>

          {geo.kind === "granted" ? (
            <div className="rounded-xl border border-border/60 bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-lime-gradient text-[11px] font-bold text-primary-foreground">
                    ✓
                  </span>
                  <div>
                    <div className="font-medium text-foreground">Location shared</div>
                    <div className="text-xs text-muted-foreground">
                      Accurate to ~{Math.round(geo.accuracy)} m
                    </div>
                  </div>
                </div>
                <button
                  onClick={requestLocation}
                  className="rounded-full border border-border/60 px-3 py-1.5 text-xs font-medium"
                >
                  Refresh
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                onClick={requestLocation}
                disabled={geo.kind === "requesting"}
                className="w-full rounded-full border border-border/60 bg-surface px-4 py-2.5 text-sm font-medium disabled:opacity-60"
              >
                {geo.kind === "requesting"
                  ? "Requesting location…"
                  : attempt === 0
                    ? "Use my location"
                    : "Try again"}
              </button>

              {geo.kind === "denied" || geo.kind === "unavailable" ? (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs">
                  <div className="font-semibold text-destructive">Location unavailable</div>
                  <p className="mt-1 text-muted-foreground">{geo.message}</p>
                  {geo.kind === "denied" && geo.canRetry ? (
                    <button
                      onClick={requestLocation}
                      className="mt-2 rounded-full border border-border/60 bg-background px-3 py-1 text-xs font-medium"
                    >
                      Retry
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          <div className="mt-5">
            <ProfileLocationFields
              showCity={false}
              value={{ city: basics.city, searchRadiusMi: radiusMi }}
              onChange={(patch) => {
                if (patch.searchRadiusMi != null) setRadius(miToKm(patch.searchRadiusMi));
              }}
            />
          </div>
        </Section>
      )}

      {step === 3 && nextCfg && (
        <Section title={nextCfg.title}>
          <ol className="space-y-2">
            {nextCfg.steps.map((s, i) => (
              <li
                key={s.title}
                className="flex items-start gap-3 rounded-2xl border border-border/60 bg-surface p-4"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lime-gradient text-xs font-bold text-primary-foreground">
                  {i + 1}
                </div>
                <div>
                  <div className="text-sm font-semibold">{s.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{s.body}</div>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <div className="mt-6 flex items-center gap-2">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || saving}
          className="rounded-full border border-border/60 bg-surface px-4 py-2 text-xs font-medium text-foreground disabled:opacity-40"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={saving}
          className="ml-auto rounded-full bg-lime-gradient px-5 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : isLast ? (nextCfg ? nextCfg.cta : "Continue to feed") : "Continue"}
        </button>
      </div>

      <button
        onClick={() => nav({ to: "/feed" })}
        className="mt-3 w-full rounded-full px-4 py-2 text-xs text-muted-foreground"
      >
        I'll do this later
      </button>
    </div>
  );
}

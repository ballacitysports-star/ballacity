import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAccountType, type AccountType } from "@/lib/account-type";
import { SPORTS, type Sport } from "@/lib/sample-data";
import { SPORT_CONFIG } from "@/lib/sport-config";

const searchSchema = z.object({
  type: z.enum(["player", "team", "trainer", "gym"]).optional(),
});

export const Route = createFileRoute("/onboarding/welcome")({
  head: () => ({ meta: [{ title: "Welcome — OpenRun" }] }),
  validateSearch: searchSchema,
  component: OnboardingWelcomePage,
});

type NextStep = { title: string; body: string };

const NEXT_STEPS: Record<Exclude<AccountType, "player">, { title: string; steps: NextStep[]; cta: string; goto: string }> = {
  team: {
    title: "Set up your team",
    cta: "Create team profile",
    goto: "/teams/create",
    steps: [
      { title: "Team profile", body: "Name, sport, colors, and a cover image so players recognize you." },
      { title: "Roster & positions", body: "Add players and mark open spots you need to fill." },
      { title: "Host your first game", body: "Publish pickups, tryouts, or practices in seconds." },
    ],
  },
  trainer: {
    title: "Set up your trainer profile",
    cta: "Create trainer profile",
    goto: "/trainers/create",
    steps: [
      { title: "Your sport & credentials", body: "Pick a primary sport, add certifications, and describe your style." },
      { title: "Venues & availability", body: "Add locations and weekly windows so athletes can book you." },
      { title: "Accept sessions", body: "Approve or decline requests and message athletes directly." },
    ],
  },
  gym: {
    title: "Set up your gym",
    cta: "Create gym profile",
    goto: "/orgs/create",
    steps: [
      { title: "Facility profile", body: "Name, address, and photos so members can find you." },
      { title: "Invite trainers", body: "Link the coaches who run sessions at your facility." },
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

  if (type === "player") return <PlayerWelcome />;
  return <LinkedProfileWelcome type={type} />;
}

function LinkedProfileWelcome({ type }: { type: Exclude<AccountType, "player"> }) {
  const nav = useNavigate();
  const cfg = NEXT_STEPS[type];
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({ 0: true });

  const toggle = (i: number) => {
    setActive(i);
    setExpanded((e) => ({ ...e, [i]: !e[i] }));
  };

  const goBack = () => nav({ to: "/onboarding/account-type" });

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
      <button
        onClick={goBack}
        className="mb-3 self-start text-xs text-muted-foreground hover:text-foreground"
      >
        ← Change account type
      </button>
      <div>
        <div className="font-display text-2xl font-bold">{cfg.title}</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Tap a step to preview details. You can revisit any of these later from settings.
        </p>
      </div>

      <div className="mt-4 flex items-center gap-1.5" aria-label="Progress">
        {cfg.steps.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition ${
              i <= active ? "bg-lime-gradient" : "bg-border/60"
            }`}
          />
        ))}
      </div>

      <ol className="mt-4 space-y-2">
        {cfg.steps.map((s, i) => {
          const isOpen = !!expanded[i];
          const isActive = active === i;
          return (
            <li key={s.title}>
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-expanded={isOpen}
                className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition ${
                  isActive
                    ? "border-primary/50 bg-surface shadow-sm"
                    : "border-border/60 bg-surface hover:border-border"
                }`}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lime-gradient text-xs font-bold text-primary-foreground">
                  {i + 1}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">{s.title}</div>
                    <span
                      className={`ml-2 text-muted-foreground transition-transform ${
                        isOpen ? "rotate-180" : ""
                      }`}
                      aria-hidden
                    >
                      ▾
                    </span>
                  </div>
                  <div
                    className={`grid overflow-hidden text-xs text-muted-foreground transition-all ${
                      isOpen ? "mt-1 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="min-h-0">{s.body}</div>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 flex items-center gap-2">
        <button
          onClick={() => setActive((a) => Math.max(0, a - 1))}
          disabled={active === 0}
          className="rounded-full border border-border/60 bg-surface px-3 py-2 text-xs font-medium text-foreground disabled:opacity-40"
        >
          Previous
        </button>
        {active < cfg.steps.length - 1 ? (
          <button
            onClick={() => {
              const next = active + 1;
              setActive(next);
              setExpanded((e) => ({ ...e, [next]: true }));
            }}
            className="ml-auto rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground"
          >
            Next step
          </button>
        ) : (
          <button
            onClick={() => nav({ to: cfg.goto })}
            className="ml-auto rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground"
          >
            {cfg.cta}
          </button>
        )}
      </div>

      <button
        onClick={() => nav({ to: cfg.goto })}
        className="mt-4 w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground"
      >
        {cfg.cta}
      </button>
      <button
        onClick={() => nav({ to: "/feed" })}
        className="mt-2 w-full rounded-full px-4 py-2 text-xs text-muted-foreground"
      >
        I'll do this later
      </button>
    </div>
  );
}

function PlayerWelcome() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [sport, setSport] = useState<Sport | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [radius, setRadius] = useState<number>(15);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Location permission state
  type GeoState =
    | { kind: "idle" }
    | { kind: "requesting" }
    | { kind: "granted"; lat: number; lng: number; accuracy: number }
    | { kind: "denied"; message: string; canRetry: boolean }
    | { kind: "unavailable"; message: string };
  const [geo, setGeo] = useState<GeoState>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);

  const levels = useMemo(() => (sport ? SPORT_CONFIG[sport]?.ratingLevels ?? [] : []), [sport]);

  const requestLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeo({
        kind: "unavailable",
        message: "Your browser doesn't support location. You can still set your radius manually below.",
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
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        if (err.code === 1) {
          setGeo({
            kind: "denied",
            message:
              "Location is blocked. Open your browser's site settings for OpenRun, allow Location, then try again — or skip and set a radius manually below.",
            canRetry: true,
          });
        } else if (err.code === 2) {
          setGeo({
            kind: "denied",
            message: "We couldn't determine your position. Check your connection or GPS and try again.",
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

  // Persist location coordinates locally when granted.
  useEffect(() => {
    if (geo.kind !== "granted") return;
    try {
      localStorage.setItem(
        "openrun.home_coords",
        JSON.stringify({ lat: geo.lat, lng: geo.lng }),
      );
    } catch {
      /* ignore */
    }
  }, [geo]);

  // Auto-save whenever sport / level / radius changes (debounced).
  useEffect(() => {
    if (!user) return;
    if (!sport && level === null && radius === 15) return;
    const t = setTimeout(async () => {
      setStatus("saving");
      try {
        const patch: { sport?: string; skill_levels?: Record<string, string> } = {};
        if (sport) patch.sport = sport;
        if (sport && level) patch.skill_levels = { [sport]: level };
        if (Object.keys(patch).length) {
          const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
          if (error) throw error;
        }
        try {
          localStorage.setItem("openrun.default_radius_km", String(radius));
        } catch {
          /* ignore */
        }
        setStatus("saved");
      } catch (err) {
        setStatus("error");
        toast.error(err instanceof Error ? err.message : "Could not save your preferences");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [user, sport, level, radius]);

  const cont = () => nav({ to: "/feed" });

  const locationDone = geo.kind === "granted" || geo.kind === "unavailable" || geo.kind === "denied";
  const steps = [
    { key: "sport", label: "Sport", done: !!sport },
    { key: "level", label: "Level", done: !!level },
    { key: "location", label: "Location", done: locationDone },
    { key: "radius", label: "Radius", done: true },
  ];
  const completed = steps.filter((s) => s.done).length;
  const currentIdx = steps.findIndex((s) => !s.done);
  const activeIdx = currentIdx === -1 ? steps.length - 1 : currentIdx;
  const pct = Math.round((completed / steps.length) * 100);
  const allDone = completed === steps.length;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
      <div>
        <div className="font-display text-2xl font-bold">A few quick things</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Personalize your feed. Changes save automatically.
        </p>
      </div>

      {/* Step-by-step progress */}
      <div className="mt-5">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>
            Step {Math.min(activeIdx + 1, steps.length)} of {steps.length}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface">
          <div
            className="h-full bg-lime-gradient transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ol className="mt-3 flex items-center justify-between gap-2">
          {steps.map((s, i) => {
            const isActive = i === activeIdx;
            return (
              <li key={s.key} className="flex flex-1 items-center gap-2">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    s.done
                      ? "bg-lime-gradient text-primary-foreground"
                      : isActive
                        ? "border border-foreground bg-background text-foreground"
                        : "border border-border/60 bg-surface text-muted-foreground"
                  }`}
                  aria-current={isActive ? "step" : undefined}
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <span
                  className={`truncate text-xs ${
                    isActive || s.done ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <section className="mt-6">
        <div className="text-sm font-semibold">1. Primary sport</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {SPORTS.map((s) => {
            const active = sport === s.name;
            return (
              <button
                key={s.name}
                onClick={() => {
                  setSport(s.name);
                  setLevel(null);
                }}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "border-transparent bg-lime-gradient text-primary-foreground"
                    : "border-border/60 bg-surface text-foreground"
                }`}
              >
                <span className="mr-1">{s.emoji}</span>
                {s.name}
              </button>
            );
          })}
        </div>
      </section>

      {sport && levels.length > 0 ? (
        <section className="mt-6">
          <div className="text-sm font-semibold">2. Your level ({SPORT_CONFIG[sport].ratingSystem})</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {levels.map((lv) => {
              const active = level === lv;
              return (
                <button
                  key={lv}
                  onClick={() => setLevel(lv)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? "border-transparent bg-lime-gradient text-primary-foreground"
                      : "border-border/60 bg-surface text-foreground"
                  }`}
                >
                  {lv}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="mt-6">
        <div className="text-sm font-semibold">3. Location</div>
        <p className="mt-1 text-xs text-muted-foreground">
          We use your location to show nearby games. You can also skip and set a radius manually.
        </p>

        {geo.kind === "granted" ? (
          <div className="mt-3 rounded-xl border border-border/60 bg-surface p-3">
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
          <div className="mt-3 space-y-2">
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
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={requestLocation}
                      className="rounded-full border border-border/60 bg-background px-3 py-1 text-xs font-medium"
                    >
                      Retry
                    </button>
                    <span className="self-center text-[11px] text-muted-foreground">
                      or adjust the radius below to browse a wider area
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between text-sm font-semibold">
          <span>4. Search radius</span>
          <span className="text-muted-foreground">{radius} km</span>
        </div>
        <input
          type="range"
          min={1}
          max={100}
          step={1}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="mt-2 w-full accent-primary"
          aria-label="Search radius in kilometers"
        />
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>1 km</span>
          <span>50 km</span>
          <span>100 km</span>
        </div>
        {geo.kind !== "granted" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Without location, we'll use your saved city and this radius to find games.
          </p>
        ) : null}
      </section>


      <div className="mt-4 h-4 text-xs text-muted-foreground" aria-live="polite">
        {status === "saving" && "Saving…"}
        {status === "saved" && "Saved"}
        {status === "error" && "Couldn't save — try again"}
      </div>

      <button
        onClick={cont}
        disabled={status === "saving"}
        className="mt-4 w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
      >
        {allDone ? "Continue to feed" : `Continue (${completed}/${steps.length})`}
      </button>
    </div>
  );
}

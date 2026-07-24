import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
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
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
      <div>
        <div className="font-display text-2xl font-bold">{cfg.title}</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Here's what comes next. You can revisit any of these later from settings.
        </p>
      </div>
      <ol className="mt-6 space-y-3">
        {cfg.steps.map((s, i) => (
          <li
            key={s.title}
            className="flex gap-3 rounded-2xl border border-border/60 bg-surface p-4"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lime-gradient text-xs font-bold text-primary-foreground">
              {i + 1}
            </div>
            <div>
              <div className="text-sm font-semibold">{s.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
      <button
        onClick={() => nav({ to: cfg.goto })}
        className="mt-6 w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground"
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
  const [busy, setBusy] = useState(false);

  const levels = useMemo(() => (sport ? SPORT_CONFIG[sport]?.ratingLevels ?? [] : []), [sport]);

  const save = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const patch: { sport?: string; skill_levels?: Record<string, string> } = {};
      if (sport) patch.sport = sport;
      if (sport && level) patch.skill_levels = { [sport]: level };
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
        if (error) throw error;
      }
      // Persist radius as a lightweight local preference used by discovery filters.
      try {
        localStorage.setItem("openrun.default_radius_km", String(radius));
      } catch {
        /* ignore */
      }
      toast.success("You're all set.");
      nav({ to: "/feed" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save your preferences");
    } finally {
      setBusy(false);
    }
  };

  const skip = () => nav({ to: "/feed" });

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
      <div>
        <div className="font-display text-2xl font-bold">A few quick things</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Personalize your feed. You can change these anytime.
        </p>
      </div>

      <section className="mt-6">
        <div className="text-sm font-semibold">Primary sport</div>
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
          <div className="text-sm font-semibold">Your level ({SPORT_CONFIG[sport].ratingSystem})</div>
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
        <div className="flex items-center justify-between text-sm font-semibold">
          <span>Search radius</span>
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
        />
      </section>

      <button
        onClick={save}
        disabled={busy}
        className="mt-8 w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Saving…" : "Continue"}
      </button>
      <button
        onClick={skip}
        className="mt-2 w-full rounded-full px-4 py-2 text-xs text-muted-foreground"
      >
        Skip for now
      </button>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Shuffle, Users, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SKILL, tierToScore } from "@/lib/skill-rating";
import { parseSportLevels } from "@/lib/sport-levels";
import { balanceTeams, playerStrength, type BalanceQuality } from "@/lib/team-balance";

export type BalancePanelPlayer = { userId: string; displayName: string };

type Strength = { mu: number; source: "rating" | "self" | "none" };

/**
 * Reads what the host can already see — public skill ratings (hidden ones are
 * excluded by RLS) and profile levels — and turns each player into a strength.
 * A failed read degrades to "no information" rather than blocking the panel.
 */
async function fetchStrengths(sport: string, ids: string[]): Promise<Map<string, Strength>> {
  const [ratings, profiles] = await Promise.all([
    supabase.from("skill_ratings").select("user_id, mu").eq("sport", sport).in("user_id", ids),
    supabase.from("profiles").select("id, sport_levels").in("id", ids),
  ]);
  const muBy = new Map<string, number>(
    ((ratings.data ?? []) as { user_id: string; mu: number }[]).map((r) => [
      r.user_id,
      Number(r.mu),
    ]),
  );
  const selfBy = new Map<string, number | null>(
    ((profiles.data ?? []) as { id: string; sport_levels: unknown }[]).map((p) => {
      const tier = parseSportLevels(p.sport_levels)[sport]?.tier;
      return [p.id, tier ? tierToScore(sport, tier) : null];
    }),
  );
  return new Map(
    ids.map((id) => [id, playerStrength({ ratingMu: muBy.get(id), selfScore: selfBy.get(id) })]),
  );
}

const QUALITY_COPY: Record<BalanceQuality, string> = {
  even: "Even match",
  close: "Close match",
  uneven: "Best split available — levels in this group are spread wide",
};

/**
 * Host tool: suggests fair teams from the confirmed roster. Shows only the
 * teams, never anyone's number, and saves nothing — it's a starting point the
 * host can read out or paste into the game chat.
 */
export function BalancedTeamsPanel({
  sport,
  players,
}: {
  sport: string;
  players: BalancePanelPlayer[];
}) {
  const [open, setOpen] = useState(false);
  const [teamCount, setTeamCount] = useState(2);
  const [seed, setSeed] = useState(1);

  // The game page passes a fresh array on every render; key on the ids so the
  // balance is only recomputed when the roster actually changes.
  const idKey = players
    .map((p) => p.userId)
    .sort()
    .join(",");
  const ids = useMemo(() => (idKey ? idKey.split(",") : []), [idKey]);
  const names = useMemo(() => new Map(players.map((p) => [p.userId, p.displayName])), [players]);

  const { data: strengths, isLoading } = useQuery({
    queryKey: ["team-balance", sport, ids],
    enabled: open && ids.length > 0,
    staleTime: 60_000,
    queryFn: () => fetchStrengths(sport, ids),
  });

  const counts = [2, 3, 4].filter((c) => players.length >= c * 2);
  const effectiveCount = counts.includes(teamCount) ? teamCount : 2;

  const result = useMemo(() => {
    if (!strengths) return null;
    return balanceTeams(
      ids.map((id) => ({ id, mu: strengths.get(id)?.mu ?? SKILL.priorMean })),
      effectiveCount,
      seed,
    );
  }, [strengths, ids, effectiveCount, seed]);

  const rated = strengths ? ids.filter((id) => strengths.get(id)?.source === "rating").length : 0;
  const selfOnly = strengths ? ids.filter((id) => strengths.get(id)?.source === "self").length : 0;

  const copy = async () => {
    if (!result) return;
    const text = result.teams
      .map(
        (t, i) => `Team ${i + 1}: ${t.players.map((p) => names.get(p.id) ?? "Player").join(", ")}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Teams copied");
    } catch {
      toast.error("Couldn't copy — select the names instead");
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-3 flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-bold">
          <Users className="h-4 w-4 text-lime" /> Suggest balanced teams
        </span>
        <span className="text-[11px] text-muted-foreground">{players.length} players</span>
      </button>
    );
  }

  return (
    <section
      aria-label="Balanced teams"
      className="mb-3 rounded-2xl border border-border bg-surface p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="section-eyebrow text-muted-foreground">Balanced teams</div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close balanced teams"
          className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {counts.length > 1 && (
        <div className="mt-2 flex gap-1.5" role="group" aria-label="Number of teams">
          {counts.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={effectiveCount === c}
              onClick={() => setTeamCount(c)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                effectiveCount === c
                  ? "border-lime/40 bg-lime/10 text-lime"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              {c} teams
            </button>
          ))}
        </div>
      )}

      {isLoading || !result ? (
        <p className="mt-3 text-xs text-muted-foreground">Working out teams…</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {result.teams.map((t, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-background/40 p-2"
                data-testid={`team-${i + 1}`}
              >
                <div className="micro-label text-muted-foreground">Team {i + 1}</div>
                <ul className="mt-1 space-y-0.5 text-xs font-semibold">
                  {t.players.map((p) => (
                    <li key={p.id} className="truncate">
                      {names.get(p.id) ?? "Player"}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="mt-2 text-xs font-semibold">{QUALITY_COPY[result.quality]}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {rated === 0
              ? selfOnly > 0
                ? "No one here has a skill rating yet, so teams use the levels players chose."
                : "No one here has a skill rating or chosen level yet, so teams are a fair shuffle."
              : `${rated} of ${ids.length} have a skill rating${
                  selfOnly ? `; ${selfOnly} use the level they chose` : ""
                }.`}{" "}
            Only teams are shown — no one's rating.
          </p>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setSeed((s) => s + 1)}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-[11px] font-bold"
            >
              <Shuffle className="h-3 w-3" /> Shuffle
            </button>
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex items-center gap-1 rounded-full border border-lime/40 px-3 py-1.5 text-[11px] font-bold text-lime"
            >
              <Copy className="h-3 w-3" /> Copy teams
            </button>
          </div>
        </>
      )}
    </section>
  );
}

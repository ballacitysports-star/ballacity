import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Activity, Eye, EyeOff, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { generateMySkillReport, refreshMySkill } from "@/lib/skill.functions";
import type { SkillReport } from "@/lib/skill-rating.server";

type Row = {
  sport: string;
  mu: number;
  low: number;
  high: number;
  status: "provisional" | "developing" | "established";
  label: string;
  hidden: boolean;
  signals: {
    contributions?: { self: number; peer: number; video: number };
    counts?: { peer: number; video: number };
  };
  report: SkillReport | null;
  report_at: string | null;
};

const STATUS_COPY: Record<Row["status"], { label: string; tip: string }> = {
  provisional: { label: "Provisional", tip: "Limited evidence so far — play more rated games." },
  developing: { label: "Developing", tip: "Getting clearer with every game." },
  established: { label: "Established", tip: "Backed by plenty of recent evidence." },
};

function useSkillRatings(userId: string | undefined) {
  return useQuery({
    queryKey: ["skill-ratings", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("skill_ratings")
        .select("sport, mu, low, high, status, label, hidden, signals, report, report_at")
        .eq("user_id", userId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });
}

function RangeBar({ row }: { row: Row }) {
  return (
    <div className="relative mt-2 h-2 rounded-full bg-secondary" aria-hidden>
      <div
        className="absolute top-0 h-2 rounded-full bg-lime/40"
        style={{ left: `${row.low}%`, width: `${Math.max(2, row.high - row.low)}%` }}
      />
      <div
        className="absolute top-[-3px] h-3.5 w-1 rounded-full bg-lime"
        style={{ left: `calc(${row.mu}% - 2px)` }}
      />
    </div>
  );
}

function evidenceLine(row: Row): string {
  const c = row.signals?.counts;
  const parts: string[] = [];
  if (row.signals?.contributions && row.signals.contributions.self > 0)
    parts.push("self-rated level");
  if (c?.peer) parts.push(`${c.peer} peer vote${c.peer === 1 ? "" : "s"}`);
  if (c?.video) parts.push(`${c.video} analysed clip${c.video === 1 ? "" : "s"}`);
  return parts.length ? `Based on ${parts.join(", ")}.` : "";
}

export function SkillRatingCard({ userId, isOwner }: { userId?: string; isOwner?: boolean }) {
  const { data: rows = [] } = useSkillRatings(userId);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["skill-ratings", userId] });
  const [busy, setBusy] = useState<string | null>(null);

  const recompute = useMutation({
    mutationFn: () => refreshMySkill(),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't refresh"),
  });

  const report = async (sport: string) => {
    setBusy(sport);
    try {
      await generateMySkillReport({ data: { sport } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't write the report");
    } finally {
      setBusy(null);
    }
  };

  const toggleHidden = async (row: Row) => {
    const { error } = await supabase.rpc("set_skill_rating_hidden", {
      _sport: row.sport,
      _hidden: !row.hidden,
    });
    if (error) toast.error("Couldn't update visibility");
    else await refresh();
  };

  if (rows.length === 0 && !isOwner) return null;

  return (
    <section className="mt-6" aria-label="Skill rating">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="section-eyebrow flex items-center gap-1.5 text-muted-foreground">
          <Activity className="h-4 w-4" /> Skill rating
        </h2>
        {isOwner && (
          <button
            type="button"
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground hover:text-lime disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${recompute.isPending ? "animate-spin" : ""}`} /> Refresh
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-border bg-surface p-4 text-sm text-muted-foreground">
          Pick your level in a sport, then play a few games — teammates can tell us how you play
          against the game's level, and your highlight analysis adds to it. Skill ratings are only
          for adults and stay separate from your sportsmanship reputation.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row, i) => (
            <motion.div
              key={row.sport}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="rounded-3xl border border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="micro-label text-muted-foreground">{row.sport}</div>
                  <div className="mt-0.5 font-display text-xl font-bold leading-tight">
                    {row.label}
                  </div>
                </div>
                <span
                  title={STATUS_COPY[row.status].tip}
                  className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground"
                >
                  {STATUS_COPY[row.status].label}
                </span>
              </div>
              <RangeBar row={row} />
              <p className="mt-2 text-[11px] text-muted-foreground">
                {evidenceLine(row)} A range, not a verdict — it tightens as more evidence comes in.
              </p>

              {row.report && (
                <div className="mt-3 rounded-2xl border border-lime/20 bg-lime/5 p-3">
                  <div className="flex items-center gap-1.5 micro-label text-lime">
                    <Sparkles className="h-3 w-3" /> AI scouting report
                  </div>
                  <p className="mt-1 text-sm font-semibold leading-snug">{row.report.headline}</p>
                  {row.report.whyItMoved.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-xs text-foreground/80">
                      {row.report.whyItMoved.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.report.strengths.map((t) => (
                      <span
                        key={`s${t}`}
                        className="rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime"
                      >
                        ▲ {t}
                      </span>
                    ))}
                    {row.report.workOn.map((t) => (
                      <span
                        key={`w${t}`}
                        className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground"
                      >
                        ◎ {t}
                      </span>
                    ))}
                    {row.report.positions.map((t) => (
                      <span
                        key={`p${t}`}
                        className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  {row.report.levelNote && (
                    <p className="mt-2 text-xs text-muted-foreground">{row.report.levelNote}</p>
                  )}
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Written by AI from your rating data only.
                  </p>
                </div>
              )}

              {isOwner && (
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => report(row.sport)}
                    disabled={busy === row.sport}
                    className="inline-flex items-center gap-1 rounded-full border border-lime/40 px-3 py-1.5 text-xs font-bold text-lime disabled:opacity-40"
                  >
                    <Sparkles className="h-3 w-3" />
                    {busy === row.sport
                      ? "Writing…"
                      : row.report
                        ? "Update AI report"
                        : "Get AI report"}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleHidden(row)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground"
                  >
                    {row.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {row.hidden ? "Hidden from others" : "Visible to others"}
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}

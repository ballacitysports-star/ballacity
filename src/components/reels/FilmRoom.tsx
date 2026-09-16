import { useState } from "react";
import {
  Clapperboard,
  Copy,
  Film,
  Loader2,
  Minus,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { buildCareerReport, buildHighlightCompilation } from "@/lib/reels.functions";

type CareerStrength = { skill: string; evidence: string };
type CareerFix = { issue: string; why: string; drill: string };
type TrendDirection = "improving" | "steady" | "mixed" | "unclear";

type CareerReport = {
  sport: string | null;
  reelsAnalyzed: number;
  window: { from: string | null; to: string | null };
  headline: string;
  strengths: CareerStrength[];
  fixes: CareerFix[];
  trend: { direction: TrendDirection; note: string };
  nextSession: string[];
  filmingTips: string[];
};

type CompilationClip = {
  reelId: string;
  reelTitle: string;
  start: number;
  end: number;
  pace: string;
  label: string;
  why: string;
};

type Compilation = {
  title: string;
  why: string;
  totalSeconds: number;
  clips: CompilationClip[];
  reelIds: string[];
};

const TREND_ICON: Record<TrendDirection, typeof TrendingUp> = {
  improving: TrendingUp,
  steady: Minus,
  mixed: TrendingDown,
  unclear: Minus,
};

const TREND_TONE: Record<TrendDirection, string> = {
  improving: "border-lime text-lime",
  steady: "border-border text-muted-foreground",
  mixed: "border-border text-muted-foreground",
  unclear: "border-border text-muted-foreground",
};

const THEMES = ["Best finishes", "Defense", "Passing", "Season recap"] as const;

function timeRange(clip: CompilationClip): string {
  return `${clip.start.toFixed(1)}s–${clip.end.toFixed(1)}s`;
}

/**
 * Cross-reel AI: the two features that read the whole archive rather than one
 * clip — a recurring-pattern coaching report, and a "best of" cut assembled
 * from moments across separate reels.
 *
 * Both need at least a couple of processed reels, so the panel explains that
 * up front instead of letting the server refusal be the first the athlete
 * hears of it.
 */
export function FilmRoom({ readyReels }: { readyReels: number }) {
  const [tab, setTab] = useState<"career" | "compilation">("career");
  const [report, setReport] = useState<CareerReport | null>(null);
  const [comp, setComp] = useState<Compilation | null>(null);
  const [busy, setBusy] = useState<"career" | "compilation" | null>(null);
  const [theme, setTheme] = useState<string | undefined>(undefined);

  const enoughReels = readyReels >= 2;

  async function runCareer() {
    if (busy) return;
    setBusy("career");
    try {
      setReport((await buildCareerReport({ data: {} })) as CareerReport);
    } catch (e: any) {
      toast.error(e?.message ?? "The film room is unavailable right now");
    } finally {
      setBusy(null);
    }
  }

  async function runCompilation(nextTheme?: string) {
    if (busy) return;
    setBusy("compilation");
    setTheme(nextTheme);
    try {
      setComp((await buildHighlightCompilation({ data: { theme: nextTheme } })) as Compilation);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not build a compilation");
    } finally {
      setBusy(null);
    }
  }

  async function copyShotList() {
    if (!comp) return;
    const text = [
      comp.title,
      "",
      ...comp.clips.map(
        (c, i) => `${i + 1}. ${c.reelTitle} ${timeRange(c)} (${c.pace}) — ${c.label || c.why}`,
      ),
      "",
      `Total ${comp.totalSeconds.toFixed(1)}s across ${comp.reelIds.length} reels`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Shot list copied");
    } catch {
      toast.error("Could not copy — select the text instead");
    }
  }

  const TrendIcon = report ? TREND_ICON[report.trend.direction] : Minus;

  return (
    <section className="mx-5 mb-5 rounded-2xl border border-border bg-surface p-5">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-lime">
        <Film className="h-4 w-4" /> Film Room
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Looks across all your processed reels — what keeps showing up, and the best-of cut you would
        otherwise assemble by hand.
      </p>

      <div className="mt-3 flex gap-1.5">
        {(["career", "compilation"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
              tab === t ? "border-lime text-lime" : "border-border text-muted-foreground"
            }`}
          >
            {t === "career" ? "Career report" : "Compilation"}
          </button>
        ))}
      </div>

      {!enoughReels && (
        <p className="mt-3 rounded-lg border border-border/70 bg-background/60 p-2.5 text-[11px] text-muted-foreground">
          Upload and process at least two reels — these read across your archive, so a single clip
          has no pattern to find.
        </p>
      )}

      {tab === "career" && (
        <div className="mt-3">
          <button
            onClick={runCareer}
            disabled={!enoughReels || busy !== null}
            className="inline-flex items-center gap-1 rounded-full bg-lime px-3 py-1.5 text-[11px] font-semibold text-black disabled:opacity-50"
          >
            {busy === "career" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {report ? "Re-run report" : "Build my report"}
          </button>

          {busy === "career" && !report && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Reading every reel you have had analysed…
            </p>
          )}

          {report && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    TREND_TONE[report.trend.direction]
                  }`}
                >
                  <TrendIcon className="h-3 w-3" /> {report.trend.direction}
                </span>
                <span className="micro-label text-muted-foreground">
                  {report.reelsAnalyzed} reels
                  {report.sport ? ` · ${report.sport}` : ""}
                  {report.window.from ? ` · ${report.window.from} → ${report.window.to}` : ""}
                </span>
              </div>

              <p className="text-sm font-medium">{report.headline}</p>
              {report.trend.note && (
                <p className="text-[11px] text-muted-foreground">{report.trend.note}</p>
              )}

              {report.strengths.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground">
                    What keeps working
                  </p>
                  <ul className="mt-1 space-y-1">
                    {report.strengths.map((s, i) => (
                      <li key={i} className="rounded-lg border border-border/70 p-2 text-[11px]">
                        <span className="font-semibold text-lime">{s.skill}</span>
                        {s.evidence && (
                          <span className="text-muted-foreground"> — {s.evidence}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {report.fixes.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground">
                    What keeps costing you
                  </p>
                  <ul className="mt-1 space-y-1">
                    {report.fixes.map((f, i) => (
                      <li key={i} className="rounded-lg border border-border/70 p-2 text-[11px]">
                        <p className="font-semibold">{f.issue}</p>
                        {f.why && <p className="text-muted-foreground">{f.why}</p>}
                        {f.drill && (
                          <p className="mt-1 text-lime">
                            Drill: <span className="text-foreground">{f.drill}</span>
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {report.nextSession.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground">Next session</p>
                  <ul className="mt-1 list-disc pl-4 text-[11px] text-muted-foreground">
                    {report.nextSession.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {report.filmingTips.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground">Filming</p>
                  <ul className="mt-1 list-disc pl-4 text-[11px] text-muted-foreground">
                    {report.filmingTips.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "compilation" && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => runCompilation()}
              disabled={!enoughReels || busy !== null}
              className="inline-flex items-center gap-1 rounded-full bg-lime px-3 py-1.5 text-[11px] font-semibold text-black disabled:opacity-50"
            >
              {busy === "compilation" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Wand2 className="h-3 w-3" />
              )}
              {comp ? "Rebuild" : "Build my best-of"}
            </button>
            {THEMES.map((t) => (
              <button
                key={t}
                onClick={() => runCompilation(t)}
                disabled={!enoughReels || busy !== null}
                className={`rounded-full border px-2 py-1 text-[10px] disabled:opacity-50 ${
                  theme === t ? "border-lime text-lime" : "border-border text-muted-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {busy === "compilation" && !comp && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Picking the best moment from each reel and ordering the cut…
            </p>
          )}

          {comp && (
            <div className="mt-3 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{comp.title}</p>
                  {comp.why && <p className="text-[11px] text-muted-foreground">{comp.why}</p>}
                </div>
                <button
                  onClick={copyShotList}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground"
                >
                  <Copy className="h-3 w-3" /> Copy
                </button>
              </div>

              <p className="micro-label text-muted-foreground">
                {comp.clips.length} clips · {comp.totalSeconds.toFixed(1)}s · {comp.reelIds.length}{" "}
                reels
              </p>

              <ol className="space-y-1.5">
                {comp.clips.map((c, i) => (
                  <li
                    key={`${c.reelId}-${i}`}
                    className="rounded-lg border border-border/70 p-2 text-[11px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-lime text-[9px] font-bold text-black">
                        {i + 1}
                      </span>
                      <Clapperboard className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate font-semibold">{c.reelTitle}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {timeRange(c)} · {c.pace}
                      {c.label ? ` · ${c.label}` : ""}
                    </p>
                    {c.why && <p className="text-muted-foreground">{c.why}</p>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Upload,
  Video,
  Lock,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Check,
  RefreshCw,
  Eye,
  Circle,
} from "lucide-react";
import { captureClip } from "@/lib/reel-frames";
import { ReelStylePanel } from "@/components/reels/ReelStylePanel";
import {
  loadReelStyleForSport,
  normalizeReelStyle,
  reelStyleSummary,
  saveReelStyleForSport,
  SPORT_STYLE_DEFAULTS,
  DEFAULT_REEL_STYLE,
  type ReelStylePrefs,
} from "@/lib/reel-style";
import { useDefaultSports } from "@/lib/default-sports";
import { ReelStudio } from "@/components/reels/ReelStudio";
import { ReelCompare } from "@/components/reels/ReelCompare";
import {
  deleteReel,
  processMyReels,
  regenerateReelStyle,
  setReelHidden,
} from "@/lib/reels.functions";
import { ReelCoach } from "@/components/reels/ReelCoach";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/useSubscription";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { getStripeEnvironment } from "@/lib/stripe";
import { createPortalSession } from "@/utils/payments.functions";
import { FREE_TIER } from "@/lib/catalog";
import {
  recapAttempt,
  recapProgress,
  recapStepLabel,
  recapStepStates,
  shareRecap,
  type RecapSummary,
} from "@/lib/recaps";
import { Share2 } from "lucide-react";

export const Route = createFileRoute("/_tabs/reels")({
  validateSearch: (search: Record<string, unknown>) => ({
    game: typeof search.game === "string" ? search.game : "",
    title: typeof search.title === "string" ? search.title : "",
    upload: search.upload === "1" || search.upload === true ? "1" : "",
  }),
  head: () =>
    pageHead({
      path: "/reels",
      title: "Highlight reels — OpenRun",
      description: "Turn your game footage into AI-edited highlight reels you can share.",
      noindex: true,
    }),
  component: ReelsPage,
});

type Reel = {
  id: string;
  title: string;
  video_path: string;
  status: string;
  used_free: boolean;
  created_at: string;
  ai_title: string | null;
  ai_caption: string | null;
  ai_hashtags: string[] | null;
  thumbnail_path: string | null;
  error_message: string | null;
  game_id: string | null;
  game_title: string | null;
  processing_step: string | null;
  step_progress?: Record<string, any> | null;
  completed_at: string | null;
  attempts?: number | null;
  environment?: string | null;

  ai_sport?: string | null;
  ai_analysis?: { summary?: string; quality_note?: string } | null;
  ai_moments?: { label: string; frame?: number; note?: string }[] | null;
  suggested_clip?: { start_pct?: number; end_pct?: number; why?: string } | null;
  ai_timeline?: { t: number; label: string; note?: string }[] | null;
  ai_edit_plan?: {
    segments: { start: number; end: number; pace?: string; why?: string }[];
    why?: string;
    total?: number;
  } | null;
  ai_coaching?: {
    strengths?: string[];
    notes?: string[];
    drills?: string[];
    confidence?: string;
  } | null;
  ai_transcript?: { text?: string } | null;
  style_prefs?: Record<string, any> | null;
  hidden_at?: string | null;
};

function ReelCard({ reel, onRetry }: { reel: Reel; onRetry: (id: string) => Promise<void> }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showRestyle, setShowRestyle] = useState(false);
  const [restyle, setRestyle] = useState<ReelStylePrefs>(() =>
    normalizeReelStyle(reel.style_prefs),
  );
  const [restyling, setRestyling] = useState(false);
  const [manageBusy, setManageBusy] = useState<"hide" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (reel.thumbnail_path) {
      supabase.storage
        .from("highlight-videos")
        .createSignedUrl(reel.thumbnail_path, 3600)
        .then(({ data }) => {
          if (!cancelled) setThumb(data?.signedUrl ?? null);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [reel.thumbnail_path]);

  async function handlePlay() {
    if (!videoUrl) {
      const { data } = await supabase.storage
        .from("highlight-videos")
        .createSignedUrl(reel.video_path, 3600);
      if (data?.signedUrl) setVideoUrl(data.signedUrl);
    }
    setOpen(true);
  }

  const isDone = reel.status === "completed";
  const displayTitle = reel.ai_title || reel.title;
  const isProcessing = reel.status === "processing";
  const attempt = recapAttempt(reel as unknown as RecapSummary);

  return (
    <li className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-3">
        <button
          onClick={isDone ? handlePlay : undefined}
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-lime/10"
        >
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-lime">
              <Video className="h-5 w-5" />
            </div>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{displayTitle}</p>
          <p className="text-xs text-muted-foreground">
            {reel.status} · {new Date(reel.created_at).toLocaleDateString()}
            {reel.used_free && " · free"}
            {reel.hidden_at && " · hidden on profile"}
          </p>
          {reel.ai_caption && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{reel.ai_caption}</p>
          )}
          {isProcessing && (
            <div className="mt-1.5">
              <div className="flex items-center justify-between text-[10px] font-semibold text-lime">
                <span>{recapStepLabel(reel as unknown as RecapSummary)}</span>
                <span>{recapProgress(reel as unknown as RecapSummary)}%</span>
              </div>
              <div
                className="mt-1 h-1 overflow-hidden rounded-full bg-lime/15"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={recapProgress(reel as unknown as RecapSummary)}
                aria-label="Reel processing progress"
              >
                <div
                  className="h-full rounded-full bg-lime transition-all"
                  style={{ width: `${recapProgress(reel as unknown as RecapSummary)}%` }}
                />
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {recapStepStates(reel as unknown as RecapSummary).map((s) => (
                  <li
                    key={s.step}
                    className={`flex items-center gap-1.5 text-[10px] ${
                      s.state === "active"
                        ? "font-semibold text-lime"
                        : s.state === "done"
                          ? "text-muted-foreground"
                          : s.state === "failed"
                            ? "text-amber-300"
                            : "text-muted-foreground/60"
                    }`}
                  >
                    {s.state === "done" ? (
                      <Check className="h-3 w-3 shrink-0" />
                    ) : s.state === "active" ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                    ) : s.state === "failed" ? (
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                    ) : (
                      <Circle className="h-3 w-3 shrink-0" />
                    )}
                    {s.label}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-muted-foreground">
                We'll notify you when it's ready
                {attempt && attempt > 1 ? ` · retry ${attempt} of 3` : ""}
              </p>
            </div>
          )}

          {reel.status === "failed" && reel.error_message && (
            <p className="mt-1 text-[10px] text-amber-300">{reel.error_message}</p>
          )}
          {(reel.status === "failed" || isProcessing) && (
            <button
              onClick={async () => {
                setRetrying(true);
                try {
                  await onRetry(reel.id);
                } finally {
                  setRetrying(false);
                }
              }}
              disabled={retrying}
              className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
            >
              {retrying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {reel.status === "failed" ? "Try again" : "Resume processing"}
            </button>
          )}
        </div>
        {isDone && reel.game_id && (
          <button
            onClick={async () => {
              const r = await shareRecap(reel as unknown as RecapSummary, {
                id: reel.game_id!,
                title: reel.game_title || displayTitle,
              });
              if (r === "copied") toast.success("Highlight link copied");
              if (r === "failed") toast.error("Could not share this highlight");
            }}
            className="shrink-0 rounded-full border border-border p-2 text-muted-foreground"
            aria-label="Share highlight"
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {/* Visibility + deletion controls; realtime patches the row after each change. */}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={async () => {
            setManageBusy("hide");
            try {
              await setReelHidden({ data: { reelId: reel.id, hidden: !reel.hidden_at } });
              toast.success(
                reel.hidden_at ? "Reel is visible on your profile again" : "Reel hidden from your profile",
              );
            } catch (e: any) {
              toast.error(e?.message ?? "Could not update this reel");
            } finally {
              setManageBusy(null);
            }
          }}
          disabled={manageBusy !== null}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
          aria-label={reel.hidden_at ? "Show reel on profile" : "Hide reel from profile"}
        >
          {manageBusy === "hide" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : reel.hidden_at ? (
            <Eye className="h-3 w-3" />
          ) : (
            <EyeOff className="h-3 w-3" />
          )}
          {reel.hidden_at ? "Show on profile" : "Hide from profile"}
        </button>
        {confirmDelete ? (
          <>
            <button
              onClick={async () => {
                setManageBusy("delete");
                try {
                  await deleteReel({ data: { reelId: reel.id } });
                  toast.success("Reel deleted");
                } catch (e: any) {
                  toast.error(e?.message ?? "Could not delete this reel");
                } finally {
                  setManageBusy(null);
                  setConfirmDelete(false);
                }
              }}
              disabled={manageBusy !== null}
              className="inline-flex items-center gap-1 rounded-full bg-destructive px-2.5 py-1 text-[10px] font-bold text-destructive-foreground disabled:opacity-50"
            >
              {manageBusy === "delete" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Confirm delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              disabled={manageBusy !== null}
              className="rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={manageBusy !== null}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50"
            aria-label="Delete reel"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        )}
      </div>

      {open && videoUrl && (
        <ReelStudio
          videoUrl={videoUrl}
          timeline={reel.ai_timeline ?? []}
          editPlan={reel.ai_edit_plan ?? null}
          coaching={reel.ai_coaching ?? null}
          transcript={reel.ai_transcript?.text ?? null}
        />
      )}

      {isDone && (reel.ai_analysis?.summary || (reel.ai_moments ?? []).length > 0) && (
        <div className="mt-2">
          <button
            onClick={() => setShowInsights((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-lime"
          >
            <Eye className="h-3.5 w-3.5" />
            {showInsights ? "Hide what the AI saw" : "What the AI saw"}
          </button>
          {showInsights && (
            <div className="mt-2 rounded-xl border border-border bg-background/60 p-3">
              {reel.ai_sport && (
                <p className="text-[10px] font-bold uppercase tracking-wider text-lime">
                  {reel.ai_sport}
                </p>
              )}
              {reel.ai_analysis?.summary && (
                <p className="mt-1 text-xs text-muted-foreground">{reel.ai_analysis.summary}</p>
              )}
              {(reel.ai_moments ?? []).length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {(reel.ai_moments ?? []).map((m, i) => (
                    <li
                      key={`${m.label}-${i}`}
                      title={m.note || undefined}
                      className="rounded-full border border-lime/40 bg-lime/10 px-2 py-0.5 text-[10px] font-semibold text-lime"
                    >
                      {m.label}
                    </li>
                  ))}
                </ul>
              )}
              {reel.suggested_clip?.why && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  <span className="font-semibold">Best cut:</span> {reel.suggested_clip.why}
                </p>
              )}
              {reel.ai_analysis?.quality_note && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  <span className="font-semibold">Filming tip:</span>{" "}
                  {reel.ai_analysis.quality_note}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {isDone && (
        <div className="mt-2">
          <button
            onClick={() => setShowRestyle((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-lime"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {showRestyle ? "Close restyle" : "Restyle with AI"}
          </button>
          {showRestyle && (
            <div className="mt-2">
              <ReelStylePanel
                value={restyle}
                sport={reel.ai_sport ?? null}
                onChange={setRestyle}
                disabled={restyling}
              />
              <button
                onClick={async () => {
                  setRestyling(true);
                  try {
                    await regenerateReelStyle({ data: { reelId: reel.id, style: restyle } });
                    toast.success("Restyling your reel — same footage, new style");
                    setShowRestyle(false);
                  } catch (e: any) {
                    toast.error(e?.message ?? "Could not restyle this reel");
                  } finally {
                    setRestyling(false);
                  }
                }}
                disabled={restyling}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-lime px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
              >
                {restyling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Regenerate with this style
              </button>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Reuses the captured footage analysis — only the title, caption, timeline,
                edit plan, coaching, and overlays are rewritten in the new style.
              </p>
            </div>
          )}
        </div>
      )}

      {isDone && <ReelCompare reel={reel} />}

      {isDone && <ReelCoach reelId={reel.id} />}
    </li>
  );
}

function ReelsPage() {
  const { user } = useAuth();
  const { game: gameId, title: gameTitle, upload: autoUpload } = Route.useSearch();
  const { isActive, isPastDue, freeUsed, freeRemaining, loading: subLoading } = useSubscription();
  const { openCheckout, isOpen, checkoutElement, closeCheckout } = useStripeCheckout();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reels, setReels] = useState<Reel[]>([]);
  const [busy, setBusy] = useState(false);
  const [style, setStyle] = useState<ReelStylePrefs>(DEFAULT_REEL_STYLE);
  // Sport context for style defaults: the game's sport when uploading from a
  // game, otherwise the athlete's first profile sport.
  const { sports: profileSports, loaded: profileLoaded } = useDefaultSports();
  const [gameSport, setGameSport] = useState<string | null>(null);
  useEffect(() => {
    if (!gameId) {
      setGameSport(null);
      return;
    }
    let cancelled = false;
    void supabase
      .from("hosted_games")
      .select("sport")
      .eq("id", gameId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setGameSport((data as { sport?: string } | null)?.sport ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);
  const activeSport =
    [gameSport, ...profileSports].find(
      (s): s is string => !!s && s in SPORT_STYLE_DEFAULTS,
    ) ?? null;
  // Restore the style after hydration (localStorage is browser-only), then
  // re-seed whenever the active sport resolves or changes. Per-sport overrides
  // the athlete saved win; otherwise the sport's built-in default applies.
  useEffect(() => {
    if (gameId && gameSport === null) return; // wait for the game's sport
    if (!gameId && !profileLoaded) return; // wait for profile sports
    setStyle(loadReelStyleForSport(activeSport));
  }, [activeSport, gameId, gameSport, profileLoaded]);
  const styleRef = useRef(style);
  styleRef.current = style;
  const autoOpened = useRef(false);
  const sweptRef = useRef(false);
  const gameReels = gameId ? reels.filter((r) => r.game_id === gameId) : [];
  const visibleReels = gameId ? gameReels : reels;


  const canGenerate = isActive || freeRemaining > 0;
  const lockedReason = !user
    ? "Sign in to create reels"
    : !canGenerate
      ? "You've used all 3 free reels. Subscribe to keep going."
      : null;

  useEffect(() => {
    if (!user) return;
    let env: string;
    try {
      env = getStripeEnvironment();
    } catch {
      return;
    }
    let cancelled = false;
    const load = () =>
      supabase
        .from("highlight_reels")
        .select("*")
        .eq("user_id", user.id)
        .eq("environment", env)
        .order("created_at", { ascending: false })
        .then(({ data }) => {
          if (!cancelled) setReels((data as Reel[]) ?? []);
        });
    load();

    /** Applies one live row change in place so the card updates without a refetch. */
    const applyRow = (row: Reel | null, event: string) => {
      if (!row || row.environment !== env) return;
      setReels((prev) => {
        if (event === "DELETE") return prev.filter((r) => r.id !== row.id);
        const i = prev.findIndex((r) => r.id === row.id);
        if (i === -1) return [row, ...prev];
        const next = prev.slice();
        next[i] = { ...next[i], ...row };
        return next;
      });
    };

    // Live pipeline progress for this user's reels.
    const channel = supabase
      .channel(`my-reels-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "highlight_reels",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Reel | null;
          const newRow = payload.new as Reel | null;
          if (newRow?.status === "completed" && (payload.old as any)?.status !== "completed") {
            toast.success("Your highlight reel is ready");
          }
          applyRow(row, payload.eventType);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Safety net: if realtime drops while work is in flight, keep the page fresh.
  const hasWorkInFlight = reels.some((r) => r.status === "processing");
  useEffect(() => {
    if (!user || (!hasWorkInFlight && !busy)) return;
    let env: string;
    try {
      env = getStripeEnvironment();
    } catch {
      return;
    }
    const id = setInterval(() => {
      void supabase
        .from("highlight_reels")
        .select("*")
        .eq("user_id", user.id)
        .eq("environment", env)
        .order("created_at", { ascending: false })
        .then(({ data }) => {
          if (data) setReels(data as Reel[]);
        });
    }, 6000);
    return () => clearInterval(id);
  }, [user, hasWorkInFlight, busy]);


  // Deep link from a finished game: open the picker straight away.
  useEffect(() => {
    if (autoUpload !== "1" || autoOpened.current || !user || !canGenerate) return;
    autoOpened.current = true;
    fileRef.current?.click();
  }, [autoUpload, user, canGenerate]);

  // Sweep anything abandoned mid-flight (tab closed, cold error) once per visit.
  useEffect(() => {
    if (!user || sweptRef.current) return;
    const stuck = reels.some(
      (r) => r.status === "processing" && r.processing_step !== "completed",
    );
    if (!stuck) return;
    sweptRef.current = true;
    void processMyReels({ data: {} }).catch(() => {});
  }, [user, reels]);


  /** Runs the pipeline for the caller's queued reels; failures stay non-fatal. */
  async function kickOffProcessing(reelId?: string) {
    try {
      await processMyReels({ data: reelId ? { reelId } : {} });
    } catch (e: any) {
      toast.error(e?.message ?? "AI processing could not start — try again");
    }
  }

  async function handleUpload(file: File) {
    if (!user) return;
    if (!canGenerate) {
      handleSubscribe();
      return;
    }
    setBusy(true);
    try {
      const env = getStripeEnvironment();
      const base = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage
        .from("highlight-videos")
        .upload(base, file, { upsert: false });
      if (upErr) throw upErr;

      // Sample frames + audio in the browser: they become the real thumbnail and
      // the input the sports AI agent watches/listens to (the server can't run ffmpeg).
      const framePaths: string[] = [];
      const frameTimes: number[] = [];
      const { frames, audio } = await captureClip(file);
      for (let i = 0; i < frames.length; i++) {
        const framePath = `${base}.frame${i + 1}.jpg`;
        const { error } = await supabase.storage
          .from("highlight-videos")
          .upload(framePath, frames[i].blob, { upsert: true, contentType: "image/jpeg" });
        if (!error) {
          framePaths.push(framePath);
          frameTimes.push(frames[i].t);
        }
      }
      let audioPath: string | null = null;
      if (audio) {
        const p = `${base}.audio.wav`;
        const { error } = await supabase.storage
          .from("highlight-videos")
          .upload(p, audio, { upsert: true, contentType: "audio/wav" });
        if (!error) audioPath = p;
      }

      const usedFree = !isActive;
      const { data: inserted, error: insErr } = await supabase
        .from("highlight_reels")
        .insert({
          user_id: user.id,
          title: gameTitle ? `Recap · ${gameTitle}` : file.name.replace(/\.[^.]+$/, ""),
          video_path: base,
          status: "processing",
          used_free: usedFree,
          environment: env,
          game_id: gameId || null,
          game_title: gameTitle || null,
          frame_paths: framePaths.length > 0 ? framePaths : null,
          frame_times: frameTimes.length > 0 ? frameTimes : null,
          audio_path: audioPath,
          style_prefs: styleRef.current,

        } as any)
        .select("id")
        .maybeSingle();
      if (insErr) throw insErr;

      toast.success("Reel uploaded — AI is working on it now");
      void kickOffProcessing((inserted as { id?: string } | null)?.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function handleSubscribe() {
    if (!user) {
      toast.error("Please sign in first");
      return;
    }
    openCheckout({
      priceId: "ai_highlight_reel_monthly",
      returnUrl: `${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    });
  }

  async function handleManageBilling() {
    try {
      const result = await createPortalSession({
        data: { environment: getStripeEnvironment(), returnUrl: window.location.href },
      });
      if ("error" in result) throw new Error(result.error);
      window.open(result.url, "_blank");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open billing portal");
    }
  }

  if (isOpen) {
    return (
      <div className="min-h-dvh">
        <PaymentTestModeBanner />
        <div className="px-4 py-4">
          <button onClick={closeCheckout} className="text-sm text-muted-foreground underline">
            ← Back
          </button>
        </div>
        <div className="px-4 pb-12">{checkoutElement}</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <PaymentTestModeBanner />
      <header className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-lime" />
          <h1 className="text-2xl font-bold">AI Highlight Reels</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a clip and let AI generate your highlight.
        </p>
      </header>

      {gameId && (
        <section className="mx-5 mb-5 rounded-2xl border border-lime/30 bg-lime/5 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-lime">
            Recap for finished game
          </p>
          <p className="mt-1 text-sm font-semibold">{gameTitle || "Your game"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {gameReels.length > 0
              ? `${gameReels.length} recap${gameReels.length === 1 ? "" : "s"} linked to this game.`
              : "Upload footage below and we'll link the recap to this game."}
          </p>
        </section>
      )}

      {isPastDue && (
        <div className="mx-5 mb-3 flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-50/10 px-3 py-2 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Payment past due — we're retrying. Update your card to avoid losing access.
        </div>
      )}

      <section className="mx-5 mb-5 rounded-2xl border border-border bg-surface p-5">
        {subLoading ? (
          <p className="text-sm text-muted-foreground">Loading plan…</p>
        ) : isActive ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-lime">Pro · Unlimited reels</p>
              <p className="text-xs text-muted-foreground">$15 / month</p>
            </div>
            <button
              onClick={handleManageBilling}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs"
            >
              Manage <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Free trial</p>
                <p className="text-xs text-muted-foreground">
                  {freeRemaining} of 3 free reels left
                </p>
              </div>
              <span className="text-xs text-muted-foreground">{freeUsed}/3 used</span>
            </div>
            <button
              onClick={handleSubscribe}
              className="w-full rounded-xl bg-lime py-2.5 font-semibold text-black"
            >
              {freeRemaining > 0 ? "Upgrade to unlimited · $15/mo" : "Subscribe · $15/mo"}
            </button>
          </div>
        )}
      </section>

      {!isActive && (
        <section className="mx-5 mb-5 rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold">Free account includes</h2>
          <ul className="space-y-2">
            {FREE_TIER.features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-lime" aria-hidden /> {f}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ReelStylePanel
        value={style}
        sport={activeSport}
        onChange={(next) => {
          setStyle(next);
          saveReelStyleForSport(activeSport, next);
        }}
        disabled={busy}
      />

      <section className="mx-5 mb-6">
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => (canGenerate ? fileRef.current?.click() : handleSubscribe())}
          disabled={busy || !user}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-surface/50 py-8 text-sm font-medium disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
            </>
          ) : canGenerate ? (
            <>
              <Upload className="h-5 w-5 text-lime" /> Upload a clip to generate a reel
            </>
          ) : (
            <>
              <Lock className="h-5 w-5" /> Subscribe to create more reels
            </>
          )}
        </button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Style: <span className="font-semibold text-lime">{reelStyleSummary(style)}</span>
        </p>
        {lockedReason && (
          <p className="mt-2 text-center text-xs text-muted-foreground">{lockedReason}</p>
        )}
      </section>

      <section className="mx-5 pb-24">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {gameId ? "Recaps for this game" : "Your reels"}
        </h2>
        {visibleReels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {gameId
              ? "No recap for this game yet — upload footage above."
              : "No reels yet — upload your first clip above."}
          </p>
        ) : (
          <ul className="space-y-2">
            {visibleReels.map((r) => (
              <ReelCard key={r.id} reel={r} onRetry={kickOffProcessing} />
            ))}
          </ul>
        )}
        {gameId && reels.length > gameReels.length && (
          <Link
            to="/reels"
            search={{ game: "", title: "", upload: "" }}
            className="mt-3 inline-block text-xs font-semibold text-lime underline"
          >
            View all your reels
          </Link>
        )}
      </section>
    </div>
  );
}

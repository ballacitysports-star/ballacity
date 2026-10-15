import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ReelShareButton } from "@/components/reels/ReelShareButton";
import { RecapShareButton } from "@/components/RecapShareButton";
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
import { useMonetizationConfig } from "@/hooks/useMonetizationConfig";
import { priceLabelFor, productForEntitlement } from "@/lib/monetization/config";
import { needsPlaybackConversion } from "@/lib/video-support";
import {
  assertConverterReachable,
  convertToPlayableMp4,
  stripVideoMetadata,
  ConverterUnavailableError,
} from "@/lib/video-transcode";
import { buildMediaMeta, probeVideo, type ProbedVideo } from "@/lib/video-metadata";
import { RepairPlaybackButton } from "@/components/reels/RepairPlaybackButton";

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
  applyReelCopy,
  deleteReel,
  processMyReels,
  regenerateReelStyle,
  setReelHidden,
  suggestGameForReel,
} from "@/lib/reels.functions";
import { ReelCoach } from "@/components/reels/ReelCoach";
import { AiDisclosureDialog, AiDisclosureNotice } from "@/components/reels/AiVideoDisclosure";
import { useMyPrivacy } from "@/lib/privacy";
import { AI_RESULTS_CAVEAT } from "@/lib/ai-video-privacy";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { validateVideoSize } from "@/lib/video-validation";
import { finalizeVideoUpload, getMyClipLimits } from "@/lib/media-uploads.functions";
import {
  clipLengthProblem,
  exceedsResolution,
  resolutionProblem,
  uploadSizeProblem,
  type ClipLimits,
} from "@/lib/ai/upload-limits";
import { useAuth } from "@/hooks/use-auth";
import { useParentMode } from "@/hooks/use-parent-mode";
import { useMyChildStatus } from "@/lib/child-safety";
import { useSubscription } from "@/hooks/useSubscription";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { getBillingEnvironment } from "@/lib/stripe";
import { formatFullDay } from "@/lib/datetime";
import { createPortalSession } from "@/utils/payments.functions";
import { freeTierFor } from "@/lib/catalog";
import type { AdvancedAnalytics } from "@/lib/reel-analytics";
import {
  recapAttempt,
  recapProgress,
  recapStepLabel,
  recapStepStates,
  type RecapSummary,
} from "@/lib/recaps";
import { EyeOff, Film, MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";
import { ReelPostCard } from "@/components/reels/ReelPostCard";
import { FamilyShareLinks } from "@/components/reels/FamilyShareLinks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { normalizePostPackage, reelPhase } from "@/lib/reel-post";
import { familyPostErrorMessage } from "@/lib/family-posts";
import { useMyChildren } from "@/lib/child-safety";
import { ReelProgress } from "@/components/reels/ReelProgress";
import { ReelPrivacyPanel } from "@/components/reels/ReelPrivacyPanel";
import { teenReelState } from "@/lib/reel-privacy";
import { AnalyticsCoachShare } from "@/components/reels/AnalyticsCoachShare";
import { ReelFollowUp } from "@/components/reels/ReelFollowUp";
import { compareToPrior, findPriorReel } from "@/lib/reel-trends";
import { FamilyPostAudience } from "@/components/reels/FamilyPostAudience";
import { useMyCohort } from "@/lib/youth-features";
import { poseAllowedForCohort, type PoseMetrics } from "@/lib/pose-metrics";

export const Route = createFileRoute("/_tabs/reels")({
  // `child` is optional so the existing links to this page need no change.
  validateSearch: (
    search: Record<string, unknown>,
  ): { game: string; title: string; upload: string; child?: string } => ({
    game: typeof search.game === "string" ? search.game : "",
    title: typeof search.title === "string" ? search.title : "",
    upload: search.upload === "1" || search.upload === true ? "1" : "",
    child: typeof search.child === "string" && search.child ? search.child : undefined,
  }),
  head: () =>
    pageHead({
      path: "/reels",
      title: "Highlight reels — BallaCity",
      description: "Turn your game footage into AI-edited highlight reels you can share.",
      noindex: true,
    }),
  component: ReelsPage,
});

type Reel = {
  id: string;
  title: string;
  video_path: string;
  /** iPhone/Safari-friendly H.264 copy, when the source needed converting. */
  playback_path?: string | null;
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
  ai_advanced_analytics?: AdvancedAnalytics | null;
  style_prefs?: Record<string, any> | null;
  hidden_at?: string | null;
  /** New uploads start as drafts, private to their owner until posted. */
  is_draft?: boolean | null;
  /** Set on a family post: a parent's private clip of their under-13 child. */
  subject_child_id?: string | null;
  /** 13-15 only: the one team a verified guardian approved, and who approved it. */
  team_share_team_id?: string | null;
  guardian_team_approved_by?: string | null;
};

function ReelCard({
  reel,
  onRetry,
  prior,
}: {
  reel: Reel;
  onRetry: (id: string) => Promise<void>;
  /** The most recent earlier analysed reel in the same sport, for "since your last clip". */
  prior?: { title: string; created_at: string; analytics: AdvancedAnalytics } | null;
}) {
  const { cohort: myCohort } = useMyCohort();
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
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

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
        .createSignedUrl(reel.playback_path ?? reel.video_path, 3600);
      if (data?.signedUrl) setVideoUrl(data.signedUrl);
    }
    setOpen(true);
  }

  const isDone = reel.status === "completed";
  const phase = reelPhase(reel);
  const isDraft = phase === "draft";
  const postPackage = normalizePostPackage(reel.step_progress?.package);

  async function toggleHidden() {
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
  }

  // A draft opens its player straight away, so the AI cut and the Pro analytics
  // are in front of the member while they decide whether to post.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (isDraft && !autoOpened.current) {
      autoOpened.current = true;
      void handlePlay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraft]);
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
            {reel.subject_child_id
              ? "Family post · only you can see this"
              : isDraft
                ? "Draft · only you can see this"
                : phase === "posted"
                  ? "Posted"
                  : reel.status}{" "}
            · {new Date(reel.created_at).toLocaleDateString()}
            {reel.used_free && " · free"}
            {reel.hidden_at && " · hidden on profile"}
          </p>
          {myCohort === "teen_13_15" && !reel.subject_child_id && (
            <p className="text-[11px] font-semibold text-lime">
              {teenReelState(reel) === "team"
                ? "Shared with your team's coaches and members · approved by your guardian"
                : "Guardian only · not public"}
            </p>
          )}
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
        {phase === "posted" && !reel.subject_child_id && (
          <ReelShareButton
            reelId={reel.id}
            title={displayTitle}
            caption={reel.ai_caption}
            hashtags={reel.ai_hashtags}
          />
        )}
        {isDone && reel.game_id && !reel.subject_child_id && (
          <RecapShareButton
            recap={reel as unknown as RecapSummary}
            game={{ id: reel.game_id, title: reel.game_title || displayTitle }}
            className="shrink-0 rounded-full border border-border p-2 text-muted-foreground"
            label="Share highlight"
          >
            <Share2 className="h-3.5 w-3.5" />
          </RecapShareButton>
        )}
      </div>
      {isDraft && (
        <ReelPostCard
          reelId={reel.id}
          title={displayTitle}
          currentCaption={reel.ai_caption}
          currentHashtags={reel.ai_hashtags}
          pkg={postPackage}
          heldBySafety={!!reel.hidden_at}
        />
      )}

      {isDone && reel.subject_child_id && <FamilyPostAudience reelId={reel.id} />}
      {isDone && reel.subject_child_id && <FamilyShareLinks reelId={reel.id} />}

      {/* Secondary actions live in one menu; realtime patches the row after each change. */}
      <div className="mt-2 flex items-center gap-2">
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={manageBusy !== null}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
                aria-label="More actions for this reel"
              >
                {manageBusy === "hide" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <MoreHorizontal className="h-3.5 w-3.5" />
                )}
                More
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {!isDraft && !reel.subject_child_id && (
                <DropdownMenuItem onSelect={() => void toggleHidden()}>
                  {reel.hidden_at ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  {reel.hidden_at ? "Show on profile" : "Hide from profile"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  setNameDraft(displayTitle);
                  setRenaming(true);
                }}
              >
                <Pencil className="h-4 w-4" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-4 w-4" /> Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Name this highlight before it goes out on the public feed. */}
      {renaming && (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const title = nameDraft.trim();
            if (!title) return;
            setSavingName(true);
            try {
              await applyReelCopy({ data: { reelId: reel.id, title } });
              toast.success("Reel title updated");
              setRenaming(false);
            } catch (err: any) {
              toast.error(err?.message ?? "Could not rename this reel");
            } finally {
              setSavingName(false);
            }
          }}
        >
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={120}
            autoFocus
            placeholder="Name this highlight"
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
            aria-label="Reel title"
          />
          <button
            type="submit"
            disabled={savingName || !nameDraft.trim()}
            className="rounded-lg bg-lime px-2.5 py-1.5 text-[11px] font-bold text-primary-foreground disabled:opacity-50"
          >
            {savingName ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setRenaming(false)}
            className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Owner-side playback repair: converts screen recordings that only play
          in some browsers into a baseline H.264 copy that plays everywhere. */}
      {isDone && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-border bg-background/60 p-2">
          <p className="min-w-0 flex-1 text-[10px] text-muted-foreground">
            {reel.playback_path
              ? "iPhone & Safari copy ready."
              : "Screen recording? Convert it so it plays on iPhone and Safari."}
          </p>
          <RepairPlaybackButton
            reelId={reel.id}
            videoPath={reel.video_path}
            label={reel.playback_path ? "Re-run fix" : "Fix playback"}
          />
        </div>
      )}

      {open && videoUrl && (
        <ReelStudio
          videoUrl={videoUrl}
          timeline={reel.ai_timeline ?? []}
          editPlan={reel.ai_edit_plan ?? null}
          coaching={reel.ai_coaching ?? null}
          transcript={reel.ai_transcript?.text ?? null}
          analytics={reel.ai_advanced_analytics ?? null}
          title={reel.ai_title || reel.title}
        />
      )}

      {isDone &&
        reel.ai_advanced_analytics &&
        prior &&
        (() => {
          const followUp = compareToPrior(reel.ai_advanced_analytics!, {
            id: "prior",
            title: prior.title,
            created_at: prior.created_at,
            analytics: prior.analytics,
          });
          return followUp ? (
            <ReelFollowUp followUp={followUp} drills={reel.ai_coaching?.drills ?? []} />
          ) : null;
        })()}

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
              <p className="mb-2 text-[10px] italic text-muted-foreground">{AI_RESULTS_CAVEAT}</p>
              {reel.ai_sport && <p className="micro-label text-lime">{reel.ai_sport}</p>}
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
                Reuses the captured footage analysis — only the title, caption, timeline, edit plan,
                coaching, and overlays are rewritten in the new style.
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
  const { isParentMode } = useParentMode();
  const navigate = useNavigate();
  const { can: canChildFeature } = useMyChildStatus();
  const { cohort: myCohort } = useMyCohort();
  const uploadDecision = canChildFeature("video_upload");
  const {
    game: gameId,
    title: gameTitle,
    upload: autoUpload,
    child: childParam,
  } = Route.useSearch();
  // Family post: a parent's private clip of their under-13 child. Only a child this
  // member is a verified guardian of counts; the database re-checks everything.
  const { children: guardianChildren, isFetched: guardianChildrenLoaded } = useMyChildren();
  const subjectChild = childParam
    ? (guardianChildren.find(
        (c) => c.childUserId === childParam && c.cohort === "child_under_13",
      ) ?? null)
    : null;
  const {
    isActive,
    isPastDue,
    freeUsed,
    freeRemaining,
    freeAllowance,
    unlimitedReels,
    access,
    paymentsConfigured,
    loading: subLoading,
  } = useSubscription();
  const { openCheckout, isOpen, checkoutElement, closeCheckout } = useStripeCheckout();
  const { config: monetization } = useMonetizationConfig();
  const plusProduct = productForEntitlement("player_plus", monetization);
  const plusPriceLabel = plusProduct ? `${priceLabelFor(plusProduct)}` : "";
  const fileRef = useRef<HTMLInputElement>(null);
  const [reels, setReels] = useState<Reel[]>([]);
  const [busy, setBusy] = useState(false);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const { prefs: privacyPrefs, update: updatePrivacy } = useMyPrivacy();
  const [style, setStyle] = useState<ReelStylePrefs>(DEFAULT_REEL_STYLE);
  /** Athlete-chosen name for the next upload (e.g. "Sunday soccer hat trick"). */
  const [titleDraft, setTitleDraft] = useState("");
  /** Best-guess game for an upload started outside a game screen. */
  const [autoGame, setAutoGame] = useState<{
    id: string;
    title: string;
    sport: string | null;
    date: string | null;
  } | null>(null);
  const [autoLink, setAutoLink] = useState(true);
  // Sport context for style defaults: the game's sport when uploading from a
  // game, otherwise the athlete's first profile sport.
  const { sports: profileSports, loaded: profileLoaded } = useDefaultSports();
  const [gameSport, setGameSport] = useState<string | null>(null);
  useEffect(() => {
    if (isParentMode) navigate({ to: "/highlights", replace: true });
  }, [isParentMode, navigate]);
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
  // Without an explicit ?game=, look up the athlete's closest game in time so
  // the reel links itself and the public card shows the right sport and timing.
  useEffect(() => {
    if (!user || gameId) {
      setAutoGame(null);
      return;
    }
    let cancelled = false;
    void suggestGameForReel({ data: {} })
      .then((g) => {
        if (!cancelled) setAutoGame(g ?? null);
      })
      .catch(() => {
        if (!cancelled) setAutoGame(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, gameId]);

  const activeSport =
    [gameSport, autoGame?.sport ?? null, ...profileSports].find(
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
  // Earlier reels a clip can be compared with: the athlete's own finished, posted ones.
  const trendPool = reels
    .filter((r) => r.status === "completed" && !r.is_draft && !r.subject_child_id)
    .map((r) => ({
      id: r.id,
      title: r.title,
      created_at: r.created_at,
      analytics: r.ai_advanced_analytics,
    }));

  const canGenerate = isActive || unlimitedReels || freeRemaining > 0;
  const lockedReason = !user
    ? "Sign in to create reels"
    : !canGenerate
      ? paymentsConfigured
        ? `You've used all ${freeAllowance} free reels. Subscribe to keep going.`
        : `You've used all ${freeAllowance} free reels. Subscriptions aren't available yet — check back soon.`
      : null;

  useEffect(() => {
    if (!user) return;
    const env = getBillingEnvironment();
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
    const env = getBillingEnvironment();
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

  /**
   * Nothing is uploaded until the AI disclosure has been seen and accepted at
   * least once; after that the short notice on the page carries the reminder.
   */
  function startUpload() {
    if (!uploadDecision.allowed) {
      toast.error(uploadDecision.reason || "A parent or guardian must approve this account first.");
      return;
    }
    if (!privacyPrefs.ai_disclosure_ack_at) {
      setDisclosureOpen(true);
      return;
    }
    fileRef.current?.click();
  }

  async function ackDisclosure() {
    try {
      await updatePrivacy({ ai_disclosure_ack_at: new Date().toISOString() });
    } catch {
      // Acknowledgement is a convenience record; never block the upload on it.
    }
  }

  // Deep link from a finished game: still show the disclosure before the picker.
  useEffect(() => {
    if (autoUpload !== "1" || autoOpened.current || !user || !canGenerate) return;
    autoOpened.current = true;
    startUpload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUpload, user, canGenerate, privacyPrefs.ai_disclosure_ack_at]);

  // Sweep anything abandoned mid-flight (tab closed, cold error) once per visit.
  useEffect(() => {
    if (!user || sweptRef.current) return;
    const stuck = reels.some((r) => r.status === "processing" && r.processing_step !== "completed");
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

  async function handleUpload(picked: File) {
    let file = picked;
    // Never fall back to an ordinary (potentially public) reel when the link asked
    // for a family post but the guardian relationship can't be confirmed.
    if (childParam && !subjectChild) {
      toast.error(
        "We couldn't confirm you're a parent or guardian of this child, so nothing was uploaded.",
      );
      return;
    }
    if (!user) return;
    if (!uploadDecision.allowed) {
      toast.error(uploadDecision.reason || "A parent or guardian must approve this account first.");
      return;
    }
    if (!canGenerate) {
      handleSubscribe();
      return;
    }
    setBusy(true);
    try {
      // Not getStripeEnvironment(): a free reel involves no charge, so an
      // unconfigured Stripe key must not turn an upload into a payment error.
      const env = getBillingEnvironment();
      // Size only. Any container is welcome — what makes a clip acceptable is
      // that a playable copy of it exists by the end of this block, not what it
      // arrived as. The old extension/MIME allowlist rejected .avi/.mkv/.wmv
      // outright, which are exactly the formats the converter below handles.
      const invalid = validateVideoSize({ bytes: file.size });
      if (invalid) throw new Error(invalid);

      // The plan's clip limits, checked here so an over-limit clip is refused
      // before minutes of conversion and upload. The server re-checks both on
      // finalize; if this lookup fails, that check still stands.
      const clipLimits: ClipLimits | null = await getMyClipLimits().catch(() => null);
      const tooBig = clipLimits ? uploadSizeProblem(file.size, clipLimits) : null;
      if (tooBig) throw new Error(tooBig);

      // What the clip actually is (length, size, which way up). Measured here
      // because the server runtime has no ffprobe; kept so a viewer's player and
      // a later support question both have the facts.
      // A clip of a child leaves this device without its location, device or
      // creation-time tags. Done before anything is stored, and the original is
      // never kept: if it cannot be cleaned, nothing is uploaded.
      if (subjectChild) {
        await assertConverterReachable();
        const cleanId = toast.loading("Removing location and device info… 0%");
        const clean = await stripVideoMetadata(file, (r) =>
          toast.loading(`Removing location and device info… ${Math.round(r * 100)}%`, {
            id: cleanId,
          }),
        );
        toast.dismiss(cleanId);
        if (!clean) {
          throw new Error(
            "We couldn't remove the location info from this clip, so nothing was uploaded. Try a shorter clip, or a desktop browser.",
          );
        }
        file = clean;
      }

      const originalProbe = await probeVideo(file);
      const tooLong = clipLimits
        ? clipLengthProblem(originalProbe.durationSeconds, clipLimits)
        : null;
      if (tooLong) throw new Error(tooLong);

      // Convert BEFORE storing anything. This ordering is the whole fix: the
      // conversion used to run after the upload and after a container gate that
      // had already thrown the file away, so the pipeline refused the clips it
      // could have rescued. Deciding first also means a clip we cannot make
      // playable leaves nothing behind to clean up.
      let playable: Blob = file;
      let converted = false;
      let processedInfo: (ProbedVideo & { bytes: number; pass: string }) | null = null;
      // A clip over the plan's resolution is shrunk on the way through; the
      // server refuses a served copy that is still too large.
      const mustShrink = clipLimits ? exceedsResolution(originalProbe, clipLimits) : false;
      const conversionAttempted = mustShrink || (await needsPlaybackConversion(file));
      if (conversionAttempted) {
        // Check the converter exists before promising anything. Without this a
        // missing wasm core reads as "your clip failed", sending the athlete off
        // to re-encode on a desktop over a problem only we can fix.
        await assertConverterReachable();
        const toastId = toast.loading("Making this clip play everywhere… 0%");
        const result = await convertToPlayableMp4(
          file,
          (r, pass) =>
            toast.loading(
              pass === "standard"
                ? `Making this clip play everywhere… ${Math.round(r * 100)}%`
                : `Retrying with lighter settings (${pass})… ${Math.round(r * 100)}%`,
              { id: toastId },
            ),
          { maxLongEdge: clipLimits?.maxResolution },
        );
        if (!result) {
          toast.dismiss(toastId);
          if (mustShrink && clipLimits) {
            throw new Error(
              `${resolutionProblem(originalProbe, clipLimits)} It couldn't be resized on this device. Record at a lower resolution, or try again on a desktop browser.`,
            );
          }
          // Every pass failed, so no copy of this clip would play. Refusing is
          // kinder than storing a reel that shows a dead player to everyone who
          // opens it; the two things that actually work are named so the athlete
          // has a next step rather than just a rejection.
          throw new Error(
            "This clip couldn't be prepared for playback on this device. Try again on a desktop browser, or re-upload it from your Photos app.",
          );
        }
        playable = result.blob;
        converted = true;
        processedInfo = {
          ...(await probeVideo(result.blob)),
          bytes: result.blob.size,
          pass: result.pass,
        };
        toast.success("Ready — this reel plays on every device", { id: toastId });
      }

      const base = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      let playbackPath: string | null = null;

      // The original always lands at `base`. How it is finalized depends on
      // whether anything will ever play it: without a converted copy it IS the
      // reel, so it faces the container sniff; with one it is a `source`, which
      // keeps the size and ownership checks but skips the sniff, because
      // refusing exotic containers is the bug being fixed. Keeping it is not
      // sentimental — RepairPlaybackButton re-converts from `video_path`, so
      // discarding the original would make "Re-run fix" impossible.
      const { error: upErr } = await supabase.storage
        .from("highlight-videos")
        .upload(base, file, { upsert: false });
      if (upErr) throw upErr;
      await finalizeVideoUpload({ data: { path: base, kind: converted ? "source" : "video" } });

      if (converted) {
        // This is the copy the feed serves (`playback_path ?? video_path`), so
        // it is the one that has to pass the sniff as a real MP4.
        const p = `${base}.h264.mp4`;
        const { error: playErr } = await supabase.storage
          .from("highlight-videos")
          .upload(p, playable, { upsert: true, contentType: "video/mp4" });
        if (playErr) throw playErr;
        await finalizeVideoUpload({ data: { path: p, kind: "video" } });
        playbackPath = p;
      }
      // Optional body tracking: adults and 16-17 only, never family clips. Only the
      // summary is kept; a null result simply leaves pose out of the record.
      let pose: PoseMetrics | null = null;
      if (!subjectChild && poseAllowedForCohort(myCohort)) {
        const poseToast = toast.loading("Measuring movement…");
        try {
          const { capturePoseMetrics } = await import("@/lib/pose-capture");
          pose = await capturePoseMetrics(playable as File);
        } catch {
          pose = null;
        } finally {
          toast.dismiss(poseToast);
        }
      }
      const mediaMeta = buildMediaMeta({
        file: { name: file.name, type: file.type, size: file.size },
        original: originalProbe,
        processed: processedInfo,
        // No playbackError: a clip that cannot be converted is refused above
        // rather than stored, so a saved reel is always "ready" or "original"
        // and never "failed".
        conversionAttempted,
        pose,
      });

      // Sample frames + audio in the browser: they become the real thumbnail and
      // the input the sports AI agent watches/listens to (the server can't run ffmpeg).
      //
      // Read from the converted copy when there is one. captureClip decodes
      // through a <video> element and returns nothing at all for a container the
      // browser can't play, so on an .avi or .mkv the original would yield no
      // thumbnail and no AI input — converting first fixes those too, not just
      // playback.
      const framePaths: string[] = [];
      const frameTimes: number[] = [];
      const clipForFrames = converted
        ? new File([playable], `${file.name}.h264.mp4`, { type: "video/mp4" })
        : file;
      // Paying members get a denser look (more frames) for Pro Analytics. In free mode
      // everyone is "active", so that alone does not count.
      const { frames, audio } = await captureClip(clipForFrames, {
        dense: isActive && !access.freeMode,
      });
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
      // Link to the game the athlete came from, or the auto-detected one.
      const linkedGame = gameId
        ? { id: gameId, title: gameTitle || "Game", sport: gameSport }
        : autoLink && autoGame
          ? { id: autoGame.id, title: autoGame.title, sport: autoGame.sport }
          : null;
      const chosenTitle = titleDraft.trim();
      const reelRow = {
        user_id: user.id,
        title:
          chosenTitle ||
          (linkedGame ? `Recap · ${linkedGame.title}` : file.name.replace(/\.[^.]+$/, "")),
        video_path: base,
        playback_path: playbackPath,
        media_meta: mediaMeta,
        status: "processing",
        used_free: usedFree,
        environment: env,
        game_id: linkedGame?.id ?? null,
        game_title: linkedGame?.title ?? null,
        // Seed the sport from the linked game so the public card is right even
        // before the AI pass finishes; the pipeline refines it afterwards.
        ai_sport: linkedGame?.sport ?? null,
        frame_paths: framePaths.length > 0 ? framePaths : null,
        frame_times: frameTimes.length > 0 ? frameTimes : null,
        audio_path: audioPath,
        style_prefs: styleRef.current,
        ...(subjectChild ? { subject_child_id: subjectChild.childUserId } : {}),
      };
      // Starts private to its owner; they review it and tap Post. If the database
      // predates drafts, fall back to the old behaviour rather than failing the upload.
      let insertRes = await supabase
        .from("highlight_reels")
        // A family post is never public, so it skips the review-and-post step.
        .insert((subjectChild ? reelRow : { ...reelRow, is_draft: true }) as any)
        .select("id")
        .maybeSingle();
      if (insertRes.error && /is_draft/i.test(insertRes.error.message ?? "")) {
        insertRes = await supabase
          .from("highlight_reels")
          .insert(reelRow as any)
          .select("id")
          .maybeSingle();
      }
      const { data: inserted, error: insErr } = insertRes;
      if (insErr) throw insErr;

      setTitleDraft("");
      toast.success("Reel uploaded — AI is working on it now");
      void kickOffProcessing((inserted as { id?: string } | null)?.id);
    } catch (e: any) {
      toast.error(
        e instanceof ConverterUnavailableError
          ? "Video conversion is temporarily unavailable. Nothing was uploaded — please try again shortly."
          : (familyPostErrorMessage(e) ?? e?.message ?? "Upload failed"),
      );
    } finally {
      setBusy(false);
    }
  }

  function handleSubscribe() {
    if (!user) {
      toast.error("Please sign in first");
      return;
    }
    if (!access.canCheckout) {
      toast.success(access.notice || "Everything is free right now — nothing to buy.");
      return;
    }
    if (!paymentsConfigured) {
      // Opening checkout here would throw inside StripeEmbeddedCheckout and
      // surface as a raw build-configuration error to an athlete.
      toast.error("Subscriptions aren't available yet — your free reels still work.");
      return;
    }
    openCheckout({
      priceId: "ai_highlight_reel_monthly",
      returnUrl: `${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    });
  }

  async function handleManageBilling() {
    try {
      // getBillingEnvironment(), not getStripeEnvironment(): the latter throws
      // when this build has no publishable key, which would leave an existing
      // subscriber with no way to reach the portal and cancel. The portal is
      // opened server-side and needs no client key.
      const result = await createPortalSession({
        data: { environment: getBillingEnvironment(), returnUrl: window.location.href },
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
          <h1 className="page-title">AI Highlight Reels</h1>
        </div>
        <p className="mt-1 page-subtitle">Upload a clip and let AI generate your highlight.</p>
        <Link
          to="/highlights"
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-bold text-lime"
        >
          <Film className="h-3.5 w-3.5" /> Browse the public highlight feed
        </Link>
      </header>

      {gameId && (
        <section className="mx-5 mb-5 rounded-2xl border border-lime/30 bg-lime/5 p-4">
          <p className="micro-label text-lime">Recap for finished game</p>
          <p className="mt-1 text-sm font-semibold">{gameTitle || "Your game"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {gameReels.length > 0
              ? `${gameReels.length} recap${gameReels.length === 1 ? "" : "s"} linked to this game.`
              : "Upload footage below and we'll link the recap to this game."}
          </p>
        </section>
      )}

      {/* Nothing is being charged while BallaCity is free, so a past-due
          warning would be alarming and meaningless. */}
      {isPastDue && access.showUpgradePrompts && (
        <div className="mx-5 mb-3 flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-50/10 px-3 py-2 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Payment past due — we're retrying. Update your card to avoid losing access.
        </div>
      )}

      <section className="mx-5 mb-6">
        {/* Name the highlight before publishing — this is the title shown on the
            public highlight feed and on the player card. */}
        <label
          className="mb-1.5 block text-xs font-semibold text-muted-foreground"
          htmlFor="reel-title"
        >
          Reel title
        </label>
        <input
          id="reel-title"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          maxLength={120}
          placeholder="e.g. Sunday basketball buzzer beater"
          className="mb-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
        />
        <p className="mb-3 text-[11px] text-muted-foreground">
          Optional — we'll fall back to the game name or file name. You can rename any reel later.
        </p>

        {!gameId && autoGame && (
          <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-surface p-3">
            <input
              type="checkbox"
              checked={autoLink}
              onChange={(e) => setAutoLink(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-lime"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold">
                Link this reel to {autoGame.title}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {[
                  autoGame.sport,
                  autoGame.date
                    ? new Date(autoGame.date).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}{" "}
                — keeps the sport and timing right on your public card.
              </span>
            </span>
          </label>
        )}

        {subjectChild && (
          <div className="mb-3 rounded-xl border border-lime/40 bg-lime/5 p-3">
            <p className="micro-label text-lime">Family post</p>
            <p className="mt-1 text-xs font-semibold">A clip of {subjectChild.displayName}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Only you can see it. It is never shown on the highlights feed, on a profile, or to
              other members. Every clip is analysed by AI, which you control in the Parent Center.
            </p>
          </div>
        )}
        {childParam && guardianChildrenLoaded && !subjectChild && (
          <p className="mb-3 rounded-xl border border-border bg-surface p-3 text-xs text-muted-foreground">
            We couldn&apos;t confirm you&apos;re a parent or guardian of this child, so uploads are
            paused. Open this from the Parent Center.
          </p>
        )}

        <AiDisclosureNotice />

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
        <AiDisclosureDialog
          open={disclosureOpen}
          onOpenChange={setDisclosureOpen}
          busy={busy}
          onContinue={() => {
            setDisclosureOpen(false);
            // Acknowledgement is remembered so the full disclosure is shown once,
            // while the short notice above stays on the page for every upload.
            void ackDisclosure();
            fileRef.current?.click();
          }}
        />
        <button
          onClick={() => (canGenerate ? startUpload() : handleSubscribe())}
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

      <ReelPrivacyPanel className="mx-5 mb-3" />

      {/* The look is remembered per sport, so it starts collapsed: the upload is
          the first thing on the page. */}
      <details className="group mb-5">
        <summary className="mx-5 mb-2 flex cursor-pointer list-none items-center justify-between rounded-xl border border-border bg-surface px-4 py-2.5 text-xs font-semibold text-muted-foreground">
          <span>
            Reel style · <span className="text-lime">{reelStyleSummary(style)}</span>
          </span>
          <span className="text-[10px] font-semibold text-lime group-open:hidden">Change</span>
        </summary>
        <ReelStylePanel
          value={style}
          sport={activeSport}
          onChange={(next) => {
            setStyle(next);
            saveReelStyleForSport(activeSport, next);
          }}
          disabled={busy}
        />
      </details>

      <section className="mx-5 mb-5">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {gameId ? "Recaps for this game" : "Your reels"}
        </h2>
        {!gameId && <ReelProgress reels={reels} />}
        {!gameId && <AnalyticsCoachShare className="mb-4" />}
        {visibleReels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {gameId
              ? "No recap for this game yet — upload footage above."
              : "No reels yet — upload your first clip above."}
          </p>
        ) : (
          <ul className="space-y-2">
            {visibleReels.map((r) => {
              const found =
                r.ai_advanced_analytics && !r.subject_child_id
                  ? findPriorReel(
                      {
                        id: r.id,
                        title: r.title,
                        created_at: r.created_at,
                        analytics: r.ai_advanced_analytics,
                      },
                      trendPool,
                    )
                  : null;
              return (
                <ReelCard
                  key={r.id}
                  reel={r}
                  onRetry={kickOffProcessing}
                  prior={
                    found && found.analytics
                      ? {
                          title: found.title,
                          created_at: found.created_at,
                          analytics: found.analytics,
                        }
                      : null
                  }
                />
              );
            })}
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

      {/* Plan and what the account includes: needed rarely, so it sits below the reels. */}
      <details className="mx-5 pb-24">
        <summary className="mb-3 cursor-pointer list-none text-xs font-semibold text-muted-foreground">
          Your plan &amp; what&apos;s included
        </summary>
        <section className="mb-5 rounded-2xl border border-border bg-surface p-5">
          {subLoading ? (
            <p className="text-sm text-muted-foreground">Loading plan…</p>
          ) : access.freeMode ? (
            <div>
              <p className="text-sm font-semibold text-lime">
                Unlimited reels · Free{access.freeUntil ? " — limited time" : ""}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {access.notice}
                {/* Same date as /plans, from the same resolved value, so the two
                  screens can never tell a member different things. */}
                {access.freeUntil ? ` Free through ${formatFullDay(access.freeUntil)}.` : ""}
              </p>
            </div>
          ) : isActive ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-lime">BallaCity+ · Unlimited reels</p>
                <p className="text-xs text-muted-foreground">{plusPriceLabel}</p>
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
                    {freeRemaining} of {freeAllowance} free reels left
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {freeUsed}/{freeAllowance} used
                </span>
              </div>
              {/* No upgrade button on a build that cannot take a payment — it
                would only lead to a checkout that immediately fails. */}
              {paymentsConfigured && access.showUpgradePrompts && (
                <button
                  onClick={handleSubscribe}
                  className="w-full rounded-xl bg-lime py-2.5 font-semibold text-black"
                >
                  {freeRemaining > 0
                    ? `Upgrade to unlimited · ${plusPriceLabel}`
                    : `Subscribe · ${plusPriceLabel}`}
                </button>
              )}
            </div>
          )}
        </section>

        {/* In free mode `isActive` is true for everyone, which would hide this
          list entirely — so key it on whether anything is actually sold. */}
        {(access.freeMode || !isActive) && (
          <section className="mb-5 rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-3 text-sm font-semibold">
              {access.freeMode ? "Your account includes" : "Free account includes"}
            </h2>
            <ul className="space-y-2">
              {freeTierFor(monetization).features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-lime" aria-hidden /> {f}
                </li>
              ))}
            </ul>
          </section>
        )}
      </details>
    </div>
  );
}

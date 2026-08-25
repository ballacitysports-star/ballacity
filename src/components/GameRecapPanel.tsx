import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  PlayCircle,
  Sparkles,
  BarChart3,
  Share2,
  Loader2,
  AlertTriangle,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  type RecapSummary,
  isRecapReady,
  pickLatestRecap,
  recapDisplayTitle,
  recapProgress,
  recapStepLabel,
  shareRecap,
} from "@/lib/recaps";

const pill =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] font-bold transition-colors";

/**
 * Recap actions + inline player for a finished game.
 * Watching a highlight never leaves the page it's rendered on.
 */
export function GameRecapPanel({
  game,
  recaps,
}: {
  game: { id: string; title: string };
  recaps: RecapSummary[];
}) {
  const latest = pickLatestRecap(recaps);
  const readyCount = recaps.filter(isRecapReady).length;
  const pending = recaps.find((r) => r.status === "processing");
  const [open, setOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(false);

  useEffect(() => {
    // A newer recap replaces the currently loaded source.
    setVideoUrl(null);
  }, [latest?.id]);

  async function togglePlayer() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!latest || videoUrl) return;
    setLoadingVideo(true);
    const { data, error } = await supabase.storage
      .from("highlight-videos")
      .createSignedUrl(latest.video_path, 3600);
    setLoadingVideo(false);
    if (error || !data?.signedUrl) {
      toast.error("Could not load that highlight");
      return;
    }
    setVideoUrl(data.signedUrl);
  }

  async function handleShare() {
    const result = await shareRecap(latest, game);
    if (result === "copied") toast.success("Highlight link copied");
    if (result === "failed") toast.error("Could not share this highlight");
  }

  return (
    <div className="mt-2 mb-1">
      {pending && (
        <div className="mb-2 rounded-xl border border-lime/30 bg-lime/5 px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] font-bold text-lime">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Recap generating · {recapStepLabel(pending)}
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-lime/15">
            <div
              className="h-full rounded-full bg-lime transition-all"
              style={{ width: `${recapProgress(pending)}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            We'll notify you the moment it's ready.
          </p>
        </div>
      )}

      {latest?.status === "failed" && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Recap generation failed{latest.error_message ? ` — ${latest.error_message}` : ""}. Try generating again.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {readyCount > 0 && (
          <button
            onClick={togglePlayer}
            className={`${pill} border-lime/40 bg-lime/10 text-lime`}
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <PlayCircle className="h-3.5 w-3.5" />}
            {open ? "Hide highlight" : `Watch highlight${readyCount > 1 ? ` (${readyCount})` : ""}`}
          </button>
        )}
        <Link
          to="/reels"
          search={{ game: game.id, title: game.title, upload: "1" }}
          className={`${pill} text-foreground hover:border-lime/40`}
        >
          <Sparkles className="h-3.5 w-3.5 text-lime" />
          {recaps.length > 0 ? "Generate another recap" : "Generate recap"}
        </Link>
        <button onClick={handleShare} className={`${pill} text-foreground hover:border-lime/40`}>
          <Share2 className="h-3.5 w-3.5" />
          Share
        </button>
        <Link
          to="/games/$gameId"
          params={{ gameId: game.id }}
          className={`${pill} text-muted-foreground hover:text-foreground`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Results
        </Link>
      </div>

      {open && latest && (
        <div className="mt-2 overflow-hidden rounded-xl border border-border bg-surface">
          {loadingVideo && (
            <div className="grid h-40 place-items-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {videoUrl && (
            <video
              src={videoUrl}
              controls
              autoPlay
              playsInline
              className="w-full bg-black"
              poster={undefined}
            />
          )}
          <div className="px-3 py-2">
            <p className="text-xs font-semibold">{recapDisplayTitle(latest)}</p>
            {latest.ai_caption && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">{latest.ai_caption}</p>
            )}
            {latest.ai_hashtags && latest.ai_hashtags.length > 0 && (
              <p className="mt-1 text-[10px] font-semibold text-lime">
                {latest.ai_hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}
              </p>
            )}
            {recaps.filter(isRecapReady).length > 1 && (
              <Link
                to="/reels"
                search={{ game: game.id, title: game.title, upload: "" }}
                className="mt-1 inline-block text-[10px] font-bold text-lime underline"
              >
                View all recaps for this game
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

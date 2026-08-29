import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Clapperboard,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Share2,
  Trash2,
} from "lucide-react";
import {
  pickLatestRecap,
  recapAttempt,
  recapStepLabel,
  shareRecap,
  type RecapSummary,
} from "@/lib/recaps";
import { deleteReel, setReelHidden } from "@/lib/reels.functions";
import { InlineVideoPlayer } from "@/components/InlineVideoPlayer";

/**
 * Per-reel manage controls for the profile card: hide/show and delete.
 * Shown only when the signed-in viewer owns the game profile.
 */
function ReelManageRow({
  reel,
  onChanged,
}: {
  reel: RecapSummary;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState<"hide" | "delete" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const hidden = !!reel.hidden_at;

  async function toggleHidden() {
    setBusy("hide");
    try {
      await setReelHidden({ data: { reelId: reel.id, hidden: !hidden } });
      toast.success(hidden ? "Reel is visible on your profile again" : "Reel hidden from your profile");
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update this reel");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setBusy("delete");
    try {
      await deleteReel({ data: { reelId: reel.id } });
      toast.success("Reel deleted");
      setConfirmingDelete(false);
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete this reel");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggleHidden}
        disabled={busy !== null}
        className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
        aria-label={hidden ? `Show ${reel.title} on profile` : `Hide ${reel.title} from profile`}
      >
        {busy === "hide" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : hidden ? (
          <Eye className="h-3 w-3" />
        ) : (
          <EyeOff className="h-3 w-3" />
        )}
        {hidden ? "Show" : "Hide"}
      </button>
      {confirmingDelete ? (
        <>
          <button
            onClick={handleDelete}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 rounded-full bg-destructive px-2.5 py-1 text-[10px] font-bold text-destructive-foreground disabled:opacity-50"
          >
            {busy === "delete" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Confirm delete
          </button>
          <button
            onClick={() => setConfirmingDelete(false)}
            disabled={busy !== null}
            className="rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground disabled:opacity-50"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          onClick={() => setConfirmingDelete(true)}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50"
          aria-label={`Delete ${reel.title}`}
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      )}
    </div>
  );
}

export function GameRecapPanel({
  game,
  recaps,
  isOwner = false,
  onChanged,
}: {
  game: { id: string; title: string };
  recaps: RecapSummary[];
  isOwner?: boolean;
  /** Reload callback fired after hide/show/delete so lists stay fresh. */
  onChanged?: () => void;
}) {
  const gameId = game.id;
  const gameTitle = game.title;
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const visibleRecaps = recaps.filter((r) => !r.hidden_at);
  const hiddenRecaps = recaps.filter((r) => !!r.hidden_at);
  const latest = pickLatestRecap(visibleRecaps);
  const readyCount = visibleRecaps.filter((r) => r.status === "completed").length;
  const pending = visibleRecaps.filter((r) => r.status === "processing" || r.status === "failed");

  useEffect(() => {
    setThumbUrl(null);
    if (!latest?.thumbnail_path) return;
    let cancelled = false;
    import("@/integrations/supabase/client").then(({ supabase }) => {
      supabase.storage
        .from("highlight-videos")
        .createSignedUrl(latest.thumbnail_path!, 3600)
        .then(({ data }) => {
          if (!cancelled) setThumbUrl(data?.signedUrl ?? null);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [latest?.id, latest?.thumbnail_path]);

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Highlight reel</p>
        <Link
          to="/reels"
          search={{ game: gameId, title: gameTitle, upload: "" }}
          className="text-xs font-medium text-lime"
        >
          {latest ? "Open in Reels" : "Create one"}
        </Link>
      </div>

      {latest ? (
        <div className="mt-2">
          <InlineVideoPlayer
            videoPath={latest.video_path}
            thumbnailUrl={thumbUrl}
            ariaLabel={`Highlight reel for ${gameTitle}`}
          />
          <p className="mt-1.5 truncate text-xs text-muted-foreground">
            {latest.ai_title || latest.title}
            {readyCount > 1 ? ` · ${readyCount} reels` : ""}
          </p>
        </div>
      ) : pending.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {pending.slice(0, 2).map((r) => {
            const attempt = recapAttempt(r);
            return (
              <div
                key={r.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-2"
              >
                {r.status === "processing" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-lime" />
                ) : (
                  <Clapperboard className="h-3.5 w-3.5 text-amber-300" />
                )}
                <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {r.status === "processing"
                    ? `Processing: ${recapStepLabel(r)}`
                    : (r.error_message ?? "Processing didn't finish")}
                  {attempt && attempt > 1 ? ` · retry ${attempt} of 3` : ""}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Wrap up the game with a short highlight reel.
        </p>
      )}

      {isOwner && (
        <div className="mt-2 space-y-2">
          {latest && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Link
                  to="/reels"
                  search={{ game: gameId, title: gameTitle, upload: "" }}
                  className="inline-flex items-center gap-1 rounded-full bg-lime px-2.5 py-1 text-[10px] font-bold text-primary-foreground"
                >
                  <Download className="h-3 w-3" /> Export
                </Link>
                <button
                  onClick={async () => {
                    const r = await shareRecap(latest, { id: gameId, title: gameTitle });
                    if (r === "copied") toast.success("Highlight link copied");
                    if (r === "failed") toast.error("Could not share this highlight");
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground"
                >
                  <Share2 className="h-3 w-3" /> Share
                </button>
              </div>
              <ReelManageRow reel={latest} onChanged={onChanged} />
            </div>
          )}

          {/* Other visible reels beyond the featured latest one */}
          {visibleRecaps
            .filter((r) => r.id !== latest?.id)
            .map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-1.5"
              >
                <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {r.ai_title || r.title}
                </p>
                <ReelManageRow reel={r} onChanged={onChanged} />
              </div>
            ))}

          {hiddenRecaps.length > 0 && (
            <div>
              <button
                onClick={() => setShowHidden((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              >
                <EyeOff className="h-3 w-3" />
                {showHidden
                  ? "Hide hidden reels"
                  : `${hiddenRecaps.length} hidden reel${hiddenRecaps.length === 1 ? "" : "s"}`}
              </button>
              {showHidden && (
                <div className="mt-1.5 space-y-1.5">
                  {hiddenRecaps.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-background/40 px-2.5 py-1.5"
                    >
                      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        <span className="mr-1 rounded bg-surface px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                          Hidden
                        </span>
                        {r.ai_title || r.title}
                      </p>
                      <ReelManageRow reel={r} onChanged={onChanged} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

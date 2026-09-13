import { useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { RepairPlaybackButton } from "@/components/reels/RepairPlaybackButton";

/**
 * Small inline video player for private "highlight-videos" storage objects:
 * resolves a signed URL on mount and shows a poster with a play affordance
 * until the athlete taps to play.
 *
 * Some uploads (e.g. screen recordings re-wrapped as .mp4 with a VP9 track)
 * cannot be decoded by every device — Safari/iOS in particular. Rather than a
 * silent dead play button, we surface a clear message plus a download link.
 */
export function InlineVideoPlayer({
  videoPath,
  fallbackVideoPath,
  videoUrl,
  fallbackVideoUrl,
  thumbnailUrl,
  ariaLabel,
  repair,
}: {
  videoPath?: string;
  /**
   * Storage path of the other copy of the same clip (usually the original when
   * `videoPath` is the converted one). Signed lazily and switched to only if the
   * first copy will not decode on this device.
   */
  fallbackVideoPath?: string | null;
  /** Pre-signed URL; when provided, client-side signing is skipped. */
  videoUrl?: string | null;
  /** Second copy of the same clip, tried automatically if the first won't decode. */
  fallbackVideoUrl?: string | null;
  thumbnailUrl?: string | null;
  ariaLabel?: string;
  /** Owner-only: lets the viewer re-encode an undecodable clip in the browser. */
  repair?: { reelId: string; videoPath: string; onRepaired?: () => void };
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);
  const [signedFallback, setSignedFallback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    setUnsupported(false);
    setPlaying(false);
    setTriedFallback(false);
    setSignedFallback(null);
    if (videoUrl !== undefined) {
      setUrl(videoUrl);
      if (!videoUrl) setFailed(true);
      return () => {
        cancelled = true;
      };
    }
    if (!videoPath) {
      setFailed(true);
      return () => {
        cancelled = true;
      };
    }
    supabase.storage
      .from("highlight-videos")
      .createSignedUrl(videoPath, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) setFailed(true);
        else setUrl(data.signedUrl);
      });
    // The second copy is signed alongside so the swap below is instant, but its
    // absence never blocks the primary copy from playing.
    if (fallbackVideoPath && fallbackVideoPath !== videoPath) {
      supabase.storage
        .from("highlight-videos")
        .createSignedUrl(fallbackVideoPath, 3600)
        .then(({ data }) => {
          if (!cancelled && data?.signedUrl) setSignedFallback(data.signedUrl);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [videoPath, videoUrl, fallbackVideoPath]);

  // Probe decodability up front so the poster can tell the truth before a tap.
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    const cleanup = () => {
      probe.removeAttribute("src");
      probe.load();
    };
    // When the primary copy won't decode, silently switch to the other copy of
    // the same clip before telling the athlete anything is wrong.
    const giveUp = () => {
      if (cancelled) return;
      if (altUrl && !triedFallback && altUrl !== url) {
        setTriedFallback(true);
        setUrl(altUrl);
      } else {
        setUnsupported(true);
      }
      cleanup();
    };
    probe.addEventListener("loadedmetadata", () => {
      if (cancelled) return;
      // A decodable track reports real dimensions; 0x0 means video is unusable.
      if (!probe.videoWidth || !probe.videoHeight) giveUp();
      else cleanup();
    });
    probe.addEventListener("error", giveUp);
    probe.src = url;
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [url, altUrl, triedFallback]);

  if (unsupported && url) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black/60">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover opacity-40" />
        ) : null}
        <div className="absolute inset-0 grid place-content-center gap-2 p-3 text-center">
          <p className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
            This video&apos;s format isn&apos;t supported on this device
          </p>
          {repair ? (
            <RepairPlaybackButton
              reelId={repair.reelId}
              videoPath={repair.videoPath}
              onRepaired={repair.onRepaired}
            />
          ) : null}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mx-auto inline-flex items-center gap-1 rounded-full bg-lime px-3 py-1 text-[11px] font-bold text-primary-foreground"
          >
            <Download className="h-3 w-3" /> Open or download
          </a>
        </div>
      </div>
    );
  }

  if (playing && url) {
    return (
      <video
        src={url}
        poster={thumbnailUrl ?? undefined}
        controls
        autoPlay
        playsInline
        onError={() => {
          if (altUrl && !triedFallback && altUrl !== url) {
            setTriedFallback(true);
            setUrl(altUrl);
            return;
          }
          setUnsupported(true);
          setPlaying(false);
        }}
        className="aspect-video w-full rounded-lg bg-black"
        aria-label={ariaLabel}
      />
    );
  }

  return (
    <button
      onClick={() => url && setPlaying(true)}
      disabled={!url}
      className="relative block aspect-video w-full overflow-hidden rounded-lg bg-black/60"
      aria-label={ariaLabel ?? "Play highlight reel"}
    >
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
      ) : null}
      <span className="absolute inset-0 grid place-items-center">
        {failed ? (
          <span className="rounded-full bg-background/80 px-3 py-1 text-xs text-muted-foreground">
            Video unavailable
          </span>
        ) : url ? (
          <span className="grid h-11 w-11 place-items-center rounded-full bg-lime text-primary-foreground">
            <Play className="h-5 w-5" />
          </span>
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </span>
    </button>
  );
}

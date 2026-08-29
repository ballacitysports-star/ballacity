import { useEffect, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Small inline video player for private "highlight-videos" storage objects:
 * resolves a signed URL on mount and shows a poster with a play affordance
 * until the athlete taps to play.
 */
export function InlineVideoPlayer({
  videoPath,
  thumbnailUrl,
  ariaLabel,
}: {
  videoPath: string;
  thumbnailUrl?: string | null;
  ariaLabel?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    supabase.storage
      .from("highlight-videos")
      .createSignedUrl(videoPath, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) setFailed(true);
        else setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [videoPath]);

  if (playing && url) {
    return (
      <video
        src={url}
        poster={thumbnailUrl ?? undefined}
        controls
        autoPlay
        playsInline
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

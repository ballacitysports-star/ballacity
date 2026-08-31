import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { convertToPlayableMp4, MAX_TRANSCODE_BYTES } from "@/lib/video-transcode";
import { setReelPlaybackPath } from "@/lib/reels.functions";

/**
 * Owner-only repair for reels whose source clip can't be decoded everywhere
 * (screen recordings with a VP9/AV1 track, .webm captures, odd containers).
 *
 * Downloads the original clip, re-encodes it to baseline H.264 in the browser
 * (the server runtime has no encoder), stores it beside the original, and
 * records it as the reel's playback copy so iPhone/Safari can play it.
 *
 * Conversion runs through several progressively lighter passes. When every pass
 * fails we stop pretending and show a fallback: what went wrong, a direct
 * download of the original, and the two things that actually work (convert on a
 * desktop browser, or re-upload the clip from the Photos app).
 */
export function RepairPlaybackButton({
  reelId,
  videoPath,
  onRepaired,
  label = "Fix playback",
}: {
  reelId: string;
  videoPath: string;
  onRepaired?: () => void;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  async function repair() {
    setBusy(true);
    setFailed(null);
    const toastId = toast.loading("Preparing this clip for iPhone & Safari… 0%");
    try {
      const { data, error } = await supabase.storage.from("highlight-videos").download(videoPath);
      if (error || !data) throw new Error("Could not read the original clip");
      const file = new File([data], videoPath.split("/").pop() || "clip.mp4", {
        type: data.type || "video/mp4",
      });
      if (file.size > MAX_TRANSCODE_BYTES) {
        throw new Error("This clip is too large to convert in the browser (over 200 MB)");
      }
      const converted = await convertToPlayableMp4(file, (r, pass) =>
        toast.loading(
          pass === "standard"
            ? `Preparing this clip for iPhone & Safari… ${Math.round(r * 100)}%`
            : `Retrying with lighter settings (${pass})… ${Math.round(r * 100)}%`,
          { id: toastId },
        ),
      );
      if (!converted) throw new Error("This clip couldn't be converted on this device");
      const path = `${videoPath}.h264.mp4`;
      const { error: upErr } = await supabase.storage
        .from("highlight-videos")
        .upload(path, converted.blob, { upsert: true, contentType: "video/mp4" });
      if (upErr) throw new Error(upErr.message);
      await setReelPlaybackPath({ data: { reelId, playbackPath: path } });
      toast.success("Fixed — this reel now plays everywhere", { id: toastId });
      setFailed(null);
      onRepaired?.();
    } catch (e: any) {
      const message = e?.message ?? "Could not fix playback for this reel";
      toast.error(message, { id: toastId });
      setFailed(message);
      // Give the athlete a working way to see their footage in the meantime.
      const { data } = await supabase.storage
        .from("highlight-videos")
        .createSignedUrl(videoPath, 3600);
      setSourceUrl(data?.signedUrl ?? null);
    } finally {
      setBusy(false);
    }
  }

  if (failed) {
    return (
      <div className="mx-auto max-w-xs space-y-1.5 text-center">
        <p className="text-[11px] font-semibold text-amber-300">{failed}</p>
        <p className="text-[10px] text-muted-foreground">
          Converting works best in desktop Chrome. You can also re-upload the clip from your
          Photos app, which saves it in a format every device plays.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <button
            onClick={repair}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-3 py-1 text-[11px] font-bold"
          >
            <Wand2 className="h-3 w-3" /> Try again
          </button>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-lime px-3 py-1 text-[11px] font-bold text-primary-foreground"
            >
              <Download className="h-3 w-3" /> Download original
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={repair}
      disabled={busy}
      className="mx-auto inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-3 py-1 text-[11px] font-bold text-foreground disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
      {busy ? "Converting…" : label}
    </button>
  );
}

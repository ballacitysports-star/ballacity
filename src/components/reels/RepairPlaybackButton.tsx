import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { transcodeToH264Mp4 } from "@/lib/video-transcode";
import { setReelPlaybackPath } from "@/lib/reels.functions";

/**
 * Owner-only repair for reels uploaded before automatic transcoding existed.
 *
 * Downloads the original clip, re-encodes it to baseline H.264 in the browser
 * (the server runtime has no encoder), stores it beside the original, and
 * records it as the reel's playback copy so iPhone/Safari can play it.
 */
export function RepairPlaybackButton({
  reelId,
  videoPath,
  onRepaired,
}: {
  reelId: string;
  videoPath: string;
  onRepaired?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function repair() {
    setBusy(true);
    const toastId = toast.loading("Preparing this clip for iPhone & Safari… 0%");
    try {
      const { data, error } = await supabase.storage.from("highlight-videos").download(videoPath);
      if (error || !data) throw new Error("Could not read the original clip");
      const file = new File([data], videoPath.split("/").pop() || "clip.mp4", {
        type: data.type || "video/mp4",
      });
      const mp4 = await transcodeToH264Mp4(file, (r) =>
        toast.loading(`Preparing this clip for iPhone & Safari… ${Math.round(r * 100)}%`, {
          id: toastId,
        }),
      );
      if (!mp4) throw new Error("This clip couldn't be converted in the browser");
      const path = `${videoPath}.h264.mp4`;
      const { error: upErr } = await supabase.storage
        .from("highlight-videos")
        .upload(path, mp4, { upsert: true, contentType: "video/mp4" });
      if (upErr) throw new Error(upErr.message);
      await setReelPlaybackPath({ data: { reelId, playbackPath: path } });
      toast.success("Fixed — this reel now plays everywhere", { id: toastId });
      onRepaired?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not fix playback for this reel", { id: toastId });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={repair}
      disabled={busy}
      className="mx-auto inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-3 py-1 text-[11px] font-bold text-foreground disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
      {busy ? "Converting…" : "Fix playback"}
    </button>
  );
}

import { useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { generateReelCoverArt } from "@/lib/reels.functions";

/**
 * Generates AI cover art for one reel and saves it as that reel's thumbnail.
 *
 * The server decides whether this restyles a real frame or generates from
 * scratch, and gates each on a different AI feature, so nothing about that
 * choice is made here. On success the new image is handed straight back so the
 * card can swap it in without waiting for a fresh signed URL.
 */
export function ReelCoverButton({
  reelId,
  onCover,
}: {
  reelId: string;
  onCover?: (dataUrl: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await generateReelCoverArt({ data: { reelId } });
      onCover?.(res.dataUrl);
      toast.success("New cover saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not generate a cover");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={run}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold text-muted-foreground disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
      {busy ? "Designing cover…" : "AI cover"}
    </button>
  );
}

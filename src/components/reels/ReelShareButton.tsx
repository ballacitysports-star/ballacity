import { useState } from "react";
import { Share2 } from "lucide-react";
import { ShareSheet } from "@/components/ShareSheet";
import { supabase } from "@/integrations/supabase/client";
import { publicReelPath, reelDownloadName } from "@/lib/social-share";
import { useMyCohort } from "@/lib/youth-features";

/**
 * Share a posted reel via its public page. Only shown to adults: the page itself
 * serves only reels whose reel_audience() is 'public' (server-side), so this is a
 * convenience, not the gate.
 * Never rendered for family clips — the caller checks subject_child_id.
 *
 * Download is offered here, on the owner's own reel, and never on the public page.
 * It signs through the owner's own storage access, so bucket RLS (including the
 * child-safety quarantine block) still applies.
 */
export function ReelShareButton({
  reelId,
  title,
  caption,
  hashtags,
  videoPath,
}: {
  reelId: string;
  title: string;
  caption: string | null;
  hashtags: string[] | null;
  /** The served copy in highlight-videos (playback_path, else video_path). */
  videoPath: string | null;
}) {
  const { cohort } = useMyCohort();
  const [open, setOpen] = useState(false);
  if (cohort !== "adult") return null;

  const download = async () => {
    if (!videoPath) throw new Error("This reel has no video to download");
    const { data, error } = await supabase.storage
      .from("highlight-videos")
      .createSignedUrl(videoPath, 300, { download: reelDownloadName(title, videoPath) });
    if (error || !data?.signedUrl) throw new Error("Couldn't prepare the download");
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-full border border-border p-2 text-muted-foreground"
        aria-label="Share reel"
      >
        <Share2 className="h-3.5 w-3.5" />
      </button>
      {open && (
        <ShareSheet
          open
          onOpenChange={setOpen}
          onDownload={videoPath ? download : undefined}
          content={{
            title,
            text: caption || title,
            url: `${window.location.origin}${publicReelPath(reelId)}`,
            hashtags: (hashtags ?? []).slice(0, 3),
          }}
        />
      )}
    </>
  );
}

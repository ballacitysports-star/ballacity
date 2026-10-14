import { useState } from "react";
import { Share2 } from "lucide-react";
import { ShareSheet } from "@/components/ShareSheet";
import { useMyAge } from "@/lib/use-my-age";

/**
 * Share a posted reel via its public page. Only shown to adults: the page itself
 * refuses anyone under 18 (server-side), so this is a convenience, not the gate.
 * Never rendered for family clips — the caller checks subject_child_id.
 */
export function ReelShareButton({
  reelId,
  title,
  caption,
  hashtags,
}: {
  reelId: string;
  title: string;
  caption: string | null;
  hashtags: string[] | null;
}) {
  const { age } = useMyAge();
  const [open, setOpen] = useState(false);
  if (age === null || age < 18) return null;
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
          content={{
            title,
            text: caption || title,
            url: `${window.location.origin}/reels/${reelId}`,
            hashtags: (hashtags ?? []).slice(0, 3),
          }}
        />
      )}
    </>
  );
}

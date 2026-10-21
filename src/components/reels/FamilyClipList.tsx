/**
 * A list of family clips with an inline player. Every open goes through the server
 * check (getFamilyClip), so a list on screen never grants access by itself.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { getFamilyClip, type FamilyClipSummary } from "@/lib/family-clips.functions";
import { familyClipViaLabel } from "@/lib/family-clips";

export function FamilyClipList({ clips }: { clips: FamilyClipSummary[] }) {
  const getFn = useServerFn(getFamilyClip);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const { data: clip, isFetching } = useQuery({
    queryKey: ["family-clip", openId],
    queryFn: () => getFn({ data: { reelId: openId as string } }),
    enabled: !!openId,
    retry: false,
  });

  return (
    <ul className="space-y-2">
      {clips.map((c) => (
        <li key={c.id} className="rounded-xl border border-border bg-surface p-3">
          <button
            type="button"
            onClick={() => {
              setShowOriginal(false);
              setOpenId(openId === c.id ? null : c.id);
            }}
            className="w-full text-left"
            aria-expanded={openId === c.id}
          >
            <p className="text-sm font-semibold">{c.title}</p>
            <p className="text-[11px] text-muted-foreground">
              {familyClipViaLabel(c.via)} · {new Date(c.createdAt).toLocaleDateString()}
            </p>
          </button>
          {openId === c.id && (
            <div className="mt-3">
              {isFetching && !clip ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : clip && clip.found ? (
                <>
                  <video
                    key={showOriginal && clip.fallbackVideoUrl ? "o" : "p"}
                    src={
                      showOriginal && clip.fallbackVideoUrl ? clip.fallbackVideoUrl : clip.videoUrl
                    }
                    poster={clip.thumbnailUrl ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full rounded-lg bg-black"
                    onError={() => {
                      if (!showOriginal && clip.fallbackVideoUrl) setShowOriginal(true);
                    }}
                  />
                  {clip.caption && <p className="mt-2 whitespace-pre-wrap text-sm">{clip.caption}</p>}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">This clip isn&apos;t available any more.</p>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

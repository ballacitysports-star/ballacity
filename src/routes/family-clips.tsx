import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { BackHeader } from "@/components/layout/BackHeader";
import { getFamilyClip, listFamilyClips } from "@/lib/family-clips.functions";
import { familyClipViaLabel } from "@/lib/family-clips";

/**
 * Family clips a member is allowed to watch: ones a parent added of the member
 * (read-only), and ones a parent shared with the member's team. Sign-in required.
 * No names appear here; every open is re-checked in the database.
 */
export const Route = createFileRoute("/family-clips")({
  head: () =>
    pageHead({
      path: "/family-clips",
      title: "Family clips — ballaCity",
      description: "Clips shared with you by a parent.",
      noindex: true,
    }),
  component: FamilyClipsPage,
});

function FamilyClipsPage() {
  const listFn = useServerFn(listFamilyClips);
  const getFn = useServerFn(getFamilyClip);
  const { data: clips = [], isLoading } = useQuery({
    queryKey: ["family-clips"],
    queryFn: () => listFn(),
    staleTime: 30_000,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: clip, isFetching } = useQuery({
    queryKey: ["family-clip", openId],
    queryFn: () => getFn({ data: { reelId: openId as string } }),
    enabled: !!openId,
    retry: false,
  });
  const [showOriginal, setShowOriginal] = useState(false);

  return (
    <div className="min-h-dvh bg-background pb-24">
      <BackHeader title="Family clips" fallbackTo="/settings" />
      <main className="page-shell-narrow px-4 pb-4 pt-4">
        <p className="text-xs text-muted-foreground">
          Clips a parent added of you, or shared with your team. Please don&apos;t forward or
          repost them.
        </p>

        {isLoading ? (
          <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-muted-foreground" />
        ) : clips.length === 0 ? (
          <div className="mt-8 text-center">
            <Lock className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm text-muted-foreground">Nothing has been shared with you.</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
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
                            showOriginal && clip.fallbackVideoUrl
                              ? clip.fallbackVideoUrl
                              : clip.videoUrl
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
                        {clip.caption && (
                          <p className="mt-2 whitespace-pre-wrap text-sm">{clip.caption}</p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        This clip isn&apos;t available any more.
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { BackHeader } from "@/components/layout/BackHeader";
import { listFamilyClips } from "@/lib/family-clips.functions";
import { FamilyClipList } from "@/components/reels/FamilyClipList";

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
  const { data: clips = [], isLoading } = useQuery({
    queryKey: ["family-clips"],
    queryFn: () => listFn(),
    staleTime: 30_000,
  });

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
          <div className="mt-4">
            <FamilyClipList clips={clips} />
          </div>
        )}
      </main>
    </div>
  );
}

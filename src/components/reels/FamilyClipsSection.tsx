/**
 * Private family clips on a child's Player Card. Shown only to someone the server
 * says may watch at least one: the parent who added them, the child, or a member of
 * a team a parent shared a clip with. Everyone else, including signed-out visitors,
 * gets nothing at all, not even a heading.
 */

import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock } from "lucide-react";
import { listFamilyClipsAboutChild } from "@/lib/family-clips.functions";
import { FamilyClipList } from "@/components/reels/FamilyClipList";

export function FamilyClipsSection({ childUserId }: { childUserId: string }) {
  const listFn = useServerFn(listFamilyClipsAboutChild);
  const { data: clips = [] } = useQuery({
    queryKey: ["family-clips-about", childUserId],
    queryFn: () => listFn({ data: { childUserId } }),
    staleTime: 30_000,
    retry: false,
  });
  if (clips.length === 0) return null;
  return (
    <section className="mt-6 px-4" aria-label="Family clips">
      <h2 className="flex items-center gap-2 font-display text-sm font-bold">
        <Lock className="h-4 w-4" aria-hidden /> Family clips
      </h2>
      <p className="mb-2 mt-1 text-[11px] text-muted-foreground">
        Private. Only you can see these here; they are not on the public card.
      </p>
      <FamilyClipList clips={clips} />
    </section>
  );
}

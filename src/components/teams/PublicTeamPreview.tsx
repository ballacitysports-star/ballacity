import { useQuery } from "@tanstack/react-query";
import { Lock, MapPin, Megaphone, ShieldCheck } from "lucide-react";
import { PublicPreviewFrame } from "@/components/public/PublicPreviewFrame";
import { SampleImage } from "@/components/public/SampleImage";
import { Skeleton } from "@/components/ui/skeleton";
import { getPublicTeam } from "@/lib/city-pages.functions";
import { spotsOpenLabel } from "@/lib/spots-urgency";
import type { PublicTeam } from "@/lib/city-seo";

/**
 * What a signed-out visitor sees at /teams/<id>: the team's public description
 * and whether it is recruiting. No roster, staff, posts or contact details. A
 * team that is hidden, aimed at under-18s, or not found gets one generic
 * prompt, so the page never says which of those it is.
 */
export function PublicTeamPreview({ teamId, next }: { teamId: string; next: string }) {
  const query = useQuery({
    queryKey: ["public-team", teamId],
    queryFn: () => getPublicTeam({ data: { id: teamId } }),
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <PublicPreviewFrame next={next} ctaLabel="Create a free account">
        <div className="space-y-3" role="status" aria-label="Loading team">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      </PublicPreviewFrame>
    );
  }

  const team: PublicTeam | null = query.data ?? null;

  return (
    <PublicPreviewFrame
      next={next}
      ctaLabel={team ? "Create a free account to follow" : "Create a free account"}
    >
      {team ? (
        <section className="space-y-4">
          <SampleImage sport={team.sports[0]} caption className="h-40 rounded-2xl sm:h-52" />
          <p className="page-eyebrow">Team</p>
          <h1 className="page-title flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-words">{team.name}</span>
            {team.verified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
                <ShieldCheck className="h-3 w-3" aria-hidden /> Verified
              </span>
            ) : null}
          </h1>
          {team.handle || team.city ? (
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              {team.handle ? <span>{team.handle}</span> : null}
              {team.city ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" aria-hidden /> {team.city}
                </span>
              ) : null}
            </p>
          ) : null}
          {team.sports.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {team.sports.map((s) => (
                <li key={s} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold">
                  {s}
                </li>
              ))}
            </ul>
          ) : null}
          {team.openSpots > 0 ? (
            <p className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-3 py-1 text-xs font-bold text-lime">
              <Megaphone className="h-3.5 w-3.5" aria-hidden /> Recruiting ·{" "}
              {spotsOpenLabel(team.openSpots)}
            </p>
          ) : null}
          {team.tagline ? <p className="text-sm text-foreground/90">{team.tagline}</p> : null}
          {team.bio ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{team.bio}</p>
          ) : null}
        </section>
      ) : (
        <section className="space-y-2 rounded-2xl border border-border bg-surface p-6 text-center">
          <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <h1 className="page-title">This team is for BallaCity members</h1>
          <p className="page-subtitle mx-auto">
            Sign in or create a free account to see the details.
          </p>
        </section>
      )}
    </PublicPreviewFrame>
  );
}

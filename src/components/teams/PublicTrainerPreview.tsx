import { useQuery } from "@tanstack/react-query";
import { Lock, MapPin, ShieldCheck } from "lucide-react";
import { PublicPreviewFrame } from "@/components/public/PublicPreviewFrame";
import { Skeleton } from "@/components/ui/skeleton";
import { getPublicTrainer } from "@/lib/city-pages.functions";
import type { PublicTrainer } from "@/lib/city-seo";

/**
 * What a signed-out visitor sees at /trainers/<id>: the trainer's public
 * description. No rates, availability, venues, reviews or contact details. A
 * profile that is hidden, aimed at under-18s, a team, or not found gets one
 * generic prompt, so the page never says which of those it is.
 */
export function PublicTrainerPreview({ trainerId, next }: { trainerId: string; next: string }) {
  const query = useQuery({
    queryKey: ["public-trainer", trainerId],
    queryFn: () => getPublicTrainer({ data: { id: trainerId } }),
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <PublicPreviewFrame next={next} ctaLabel="Create a free account">
        <div className="space-y-3" role="status" aria-label="Loading trainer">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      </PublicPreviewFrame>
    );
  }

  const trainer: PublicTrainer | null = query.data ?? null;

  return (
    <PublicPreviewFrame
      next={next}
      ctaLabel={trainer ? "Create a free account to book" : "Create a free account"}
    >
      {trainer ? (
        <section className="space-y-4">
          <p className="page-eyebrow">Trainer</p>
          <h1 className="page-title flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-words">{trainer.name}</span>
            {trainer.verified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
                <ShieldCheck className="h-3 w-3" aria-hidden /> Verified
              </span>
            ) : null}
          </h1>
          {trainer.handle || trainer.city ? (
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              {trainer.handle ? <span>{trainer.handle}</span> : null}
              {trainer.city ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" aria-hidden /> {trainer.city}
                </span>
              ) : null}
            </p>
          ) : null}
          {trainer.sports.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {trainer.sports.map((s) => (
                <li key={s} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold">
                  {s}
                </li>
              ))}
            </ul>
          ) : null}
          {trainer.tagline ? <p className="text-sm text-foreground/90">{trainer.tagline}</p> : null}
          {trainer.bio ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{trainer.bio}</p>
          ) : null}
        </section>
      ) : (
        <section className="space-y-2 rounded-2xl border border-border bg-surface p-6 text-center">
          <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <h1 className="page-title">This trainer is for BallaCity members</h1>
          <p className="page-subtitle mx-auto">
            Sign in or create a free account to see the details.
          </p>
        </section>
      )}
    </PublicPreviewFrame>
  );
}

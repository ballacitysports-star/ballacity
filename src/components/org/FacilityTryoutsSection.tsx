import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trophy } from "lucide-react";
import { TryoutCard } from "@/components/dashboard/TryoutCard";
import { RsvpDialog } from "@/components/tryouts/TryoutsSection";
import { useAuth } from "@/hooks/use-auth";
import { sortTryoutsByDate } from "@/lib/curated-dashboard";
import { listFacilityTryouts, type TryoutListing } from "@/lib/tryouts.functions";

/**
 * Upcoming tryouts and camps held at this facility, beside its runs. Teams link
 * a tryout to a venue by picking it from the place search when they post, so a
 * facility only lists events that genuinely resolve to its address. Renders
 * nothing when there are none.
 */
export function FacilityTryoutsSection({ orgId }: { orgId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fetchTryouts = useServerFn(listFacilityTryouts);
  const [active, setActive] = useState<TryoutListing | null>(null);
  const { data } = useQuery({
    queryKey: ["tryouts", "facility", orgId],
    queryFn: () => fetchTryouts({ data: { orgId } }),
    staleTime: 60_000,
  });

  const tryouts = sortTryoutsByDate(data ?? []);
  if (tryouts.length === 0) return null;

  const apply = (t: TryoutListing) =>
    user ? setActive(t) : navigate({ to: "/auth", search: { next: `/orgs/${orgId}` } });

  return (
    <section
      id="facility-tryouts"
      aria-labelledby="facility-tryouts-heading"
      className="rounded-2xl border border-border/60 bg-surface p-4"
    >
      <h2 id="facility-tryouts-heading" className="section-title mb-3 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-lime" /> Tryouts &amp; camps here
        <span className="text-xs font-normal text-muted-foreground">({tryouts.length})</span>
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {tryouts.map((t) => (
          <li key={t.id} className="flex">
            <TryoutCard t={t} onApply={apply} />
          </li>
        ))}
      </ul>
      {active && <RsvpDialog tryout={active} onClose={() => setActive(null)} />}
    </section>
  );
}

import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CarouselItem,
  DashboardCarousel,
  DashboardSection,
} from "@/components/dashboard/DashboardSection";
import { TryoutCard } from "@/components/dashboard/TryoutCard";
import { PostTryoutDialog, RsvpDialog } from "@/components/tryouts/TryoutsSection";
import { useAuth } from "@/hooks/use-auth";
import { sortTryoutsByDate } from "@/lib/curated-dashboard";
import { matchesSportList } from "@/lib/sport-filter";
import {
  listMyManagedTeams,
  listUpcomingTryouts,
  type TryoutListing,
} from "@/lib/tryouts.functions";

/**
 * Section 2 of the dashboard: upcoming tryouts and camps from teams and
 * coaches. "RSVP / Apply" opens the same flow as the tryout page: pick who is
 * attending (a parent can choose a linked child), sign the team waiver if the
 * team has one, and register.
 */
export function TryoutsCampsSection({ sports }: { sports: readonly string[] }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fetchTryouts = useServerFn(listUpcomingTryouts);
  const fetchManagedTeams = useServerFn(listMyManagedTeams);
  const [active, setActive] = useState<TryoutListing | null>(null);
  const [posting, setPosting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["tryouts", "upcoming"],
    queryFn: () => fetchTryouts(),
    staleTime: 60_000,
  });
  // Only people who can actually post for a team see the "Post a tryout" link.
  const managed = useQuery({
    queryKey: ["tryouts", "my-teams"],
    queryFn: () => fetchManagedTeams(),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
  const canPost = (managed.data?.length ?? 0) > 0;

  const tryouts = useMemo(
    () =>
      sortTryoutsByDate((data ?? []).filter((t) => matchesSportList(t.sports, sports as string[]))),
    [data, sports],
  );

  const apply = (t: TryoutListing) =>
    user ? setActive(t) : navigate({ to: "/auth", search: { next: "/feed" } });

  return (
    <DashboardSection
      id="tryouts-camps"
      emoji="🏆"
      title="Tryouts & Camps"
      action={
        canPost ? (
          <button type="button" onClick={() => setPosting(true)} className="text-lime">
            Post a tryout
          </button>
        ) : null
      }
    >
      {isLoading ? (
        <div
          className="h-44 animate-pulse rounded-2xl border border-border bg-surface"
          aria-hidden
        />
      ) : tryouts.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted-foreground">
          {sports.length > 0
            ? "No open tryouts or camps for the sports you picked."
            : "No open tryouts or camps right now."}
        </p>
      ) : (
        <DashboardCarousel label="Upcoming tryouts and camps">
          {tryouts.map((t) => (
            <CarouselItem key={t.id}>
              <TryoutCard t={t} onApply={apply} />
            </CarouselItem>
          ))}
        </DashboardCarousel>
      )}

      {active && <RsvpDialog tryout={active} onClose={() => setActive(null)} />}
      {posting && <PostTryoutDialog onClose={() => setPosting(false)} />}
    </DashboardSection>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { getMyTeamAvailability, setTeamEventAvailability } from "@/lib/team-availability.functions";
import { AVAILABILITY_LABEL, AVAILABILITY_STATUSES, type AvailabilityStatus } from "@/lib/team-availability";

const ACTIVE_CLASS: Record<AvailabilityStatus, string> = {
  available: "bg-lime text-primary-foreground hover:bg-lime/90",
  maybe: "bg-amber-500 text-black hover:bg-amber-500/90",
  unavailable: "bg-coral text-white hover:bg-coral/90",
};

/**
 * Lets a roster member, or the verified guardian of one, say whether they can
 * make each upcoming team event. Renders nothing for anyone else.
 */
export function TeamEventAvailabilityCard({ teamId }: { teamId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const load = useServerFn(getMyTeamAvailability);
  const save = useServerFn(setTeamEventAvailability);
  const [saving, setSaving] = useState<string | null>(null);
  const key = ["my-team-availability", teamId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => load({ data: { teamId } }),
    enabled: !!user,
    staleTime: 30_000,
    retry: false,
  });

  if (!user || !q.data || q.data.people.length === 0 || q.data.events.length === 0) return null;
  const { people, events, answers } = q.data;

  const choose = async (postId: string, userId: string, current: AvailabilityStatus | undefined, next: AvailabilityStatus) => {
    const id = `${postId}:${userId}`;
    setSaving(id);
    try {
      await save({ data: { postId, userId, status: current === next ? null : next } });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save your availability.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <section aria-labelledby="team-availability-heading" className="mt-5 rounded-2xl border border-border bg-surface p-4">
      <h2 id="team-availability-heading" className="inline-flex items-center gap-2 text-sm font-semibold">
        <CalendarCheck className="h-4 w-4" /> Your availability
      </h2>
      <p className="text-xs text-muted-foreground">Let the coaches know who can make upcoming events. Only team staff see your answers.</p>
      <ul className="mt-3 space-y-4">
        {events.map((event) => (
          <li key={event.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
            <p className="text-sm font-semibold">{event.title}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(event.eventDate).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              {event.location ? ` · ${event.location}` : ""}
            </p>
            <div className="mt-2 space-y-2">
              {people.map((person) => {
                const current = answers[event.id]?.find((a) => a.userId === person.userId)?.status;
                const busy = saving === `${event.id}:${person.userId}`;
                return (
                  <div key={person.userId} className="flex flex-wrap items-center justify-between gap-2">
                    {people.length > 1 && <span className="text-xs font-medium">{person.name}</span>}
                    <div className="flex flex-wrap gap-1" role="group" aria-label={`${person.isSelf ? "Your" : `${person.name}'s`} availability for ${event.title}`}>
                      {AVAILABILITY_STATUSES.map((status) => (
                        <Button
                          key={status}
                          size="sm"
                          variant={current === status ? "default" : "outline"}
                          aria-pressed={current === status}
                          disabled={busy}
                          className={current === status ? ACTIVE_CLASS[status] : undefined}
                          onClick={() => choose(event.id, person.userId, current, status)}
                        >
                          {AVAILABILITY_LABEL[status]}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock, MapPin, Plus, Users } from "lucide-react";
import { fetchHostedGamesForOrg } from "@/lib/hosted-games-store";
import {
  FACILITY_EVENT_KINDS,
  classifyFacilityEvent,
  facilityEventKindLabel,
  postFacilityEventSearch,
  upcomingFacilityEvents,
  type FacilityEventKind,
} from "@/lib/facility-events";
import { formatGameWhen } from "@/lib/format";
import { useIsJoined } from "@/lib/games-store";
import { useLiveParticipantCount } from "@/lib/game-participants-store";
import { useJoinGate } from "@/lib/live-status";
import type { Game } from "@/lib/sample-data";

const KIND_TONE: Record<FacilityEventKind, string> = {
  run: "bg-lime/15 text-lime",
  open_court: "bg-sky-500/15 text-sky-400",
  clinic: "bg-amber-500/15 text-amber-500",
  tournament: "bg-coral/15 text-coral",
};

function EventRow({ game }: { game: Game }) {
  const joinedByMe = useIsJoined(game.id);
  const liveCount = useLiveParticipantCount(game.id);
  const joinedCount = Math.min(
    game.maxPlayers,
    (liveCount ?? game.joined) + (joinedByMe && liveCount === undefined ? 1 : 0),
  );
  const spotsLeft = Math.max(0, game.maxPlayers - joinedCount);
  const gate = useJoinGate(game, { spotsLeft });
  const kind = classifyFacilityEvent(game);

  const cta = joinedByMe
    ? "Joined"
    : gate.liveStatus === "in_progress"
      ? "Happening now"
      : gate.locked
        ? gate.waitlistOpen
          ? "Waitlist"
          : gate.label
        : game.price > 0
          ? `Join · $${game.price}`
          : "Join · Free";
  const ctaTone =
    joinedByMe || (gate.locked && !gate.waitlistOpen)
      ? "border border-border bg-surface text-muted-foreground"
      : "bg-lime text-primary-foreground";

  return (
    <li>
      <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-background p-3">
        <Link
          to="/games/$gameId"
          params={{ gameId: game.id }}
          className="min-w-0 flex-1 hover:opacity-80"
        >
          <div className="flex items-center gap-1.5">
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${KIND_TONE[kind]}`}
            >
              {facilityEventKindLabel(kind)}
            </span>
            <h3 className="truncate font-display text-sm font-bold">{game.title}</h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1" suppressHydrationWarning>
              <Clock className="h-3 w-3 text-lime" />
              {formatGameWhen(game)}
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Users className="h-3 w-3 text-lime" />
              {spotsLeft > 0 ? `${spotsLeft} of ${game.maxPlayers} spots left` : "Full"}
            </span>
            <span>{game.skill}</span>
          </div>
        </Link>
        <Link
          to="/games/$gameId"
          params={{ gameId: game.id }}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${ctaTone}`}
        >
          {cta}
        </Link>
      </div>
    </li>
  );
}

/**
 * Upcoming runs, clinics, tournaments and open-court sessions hosted at a
 * facility. Anyone can browse; "Join" opens the game page, which runs the
 * normal approval / payment / age checks. Managers also get a post action.
 */
export function FacilityEventsSection({
  orgId,
  canPost,
}: {
  orgId: string;
  /** Owner or admin of the facility. The server re-checks before posting. */
  canPost: boolean;
}) {
  const [filter, setFilter] = useState<FacilityEventKind | "all">("all");
  const q = useQuery({
    queryKey: ["org-events", orgId],
    queryFn: () => fetchHostedGamesForOrg(orgId),
    staleTime: 30_000,
  });
  const upcoming = useMemo(() => upcomingFacilityEvents(q.data ?? []), [q.data]);
  const counts = useMemo(() => {
    const c: Record<FacilityEventKind, number> = {
      run: 0,
      open_court: 0,
      clinic: 0,
      tournament: 0,
    };
    for (const g of upcoming) c[classifyFacilityEvent(g)] += 1;
    return c;
  }, [upcoming]);
  const shown =
    filter === "all" ? upcoming : upcoming.filter((g) => classifyFacilityEvent(g) === filter);

  return (
    <section id="facility-events" className="rounded-2xl border border-border/60 bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-lime" /> Upcoming events &amp; runs
          {upcoming.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({upcoming.length})</span>
          )}
        </h2>
        {canPost && (
          <Link
            to="/create"
            search={postFacilityEventSearch(orgId)}
            className="inline-flex items-center gap-1 rounded-full bg-lime px-3 py-1.5 text-xs font-bold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> Post event / open run
          </Link>
        )}
      </div>

      {upcoming.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {[
            { kind: "all" as const, plural: "All", n: upcoming.length },
            ...FACILITY_EVENT_KINDS.map((k) => ({
              kind: k.kind,
              plural: k.plural,
              n: counts[k.kind],
            })),
          ]
            .filter((c) => c.kind === "all" || c.n > 0)
            .map((c) => (
              <button
                key={c.kind}
                type="button"
                aria-pressed={filter === c.kind}
                onClick={() => setFilter(c.kind)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  filter === c.kind
                    ? "border border-lime/40 bg-lime/15 text-lime"
                    : "border border-border text-muted-foreground"
                }`}
              >
                {c.plural} · {c.n}
              </button>
            ))}
        </div>
      )}

      {q.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-16 animate-pulse rounded-xl bg-background" />
          <div className="h-16 animate-pulse rounded-xl bg-background" />
        </div>
      ) : q.isError ? (
        <p className="text-xs text-muted-foreground">
          Couldn&apos;t load events.{" "}
          <button type="button" onClick={() => q.refetch()} className="font-semibold text-lime">
            Try again
          </button>
        </p>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center">
          <MapPin className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-1 text-sm font-semibold">No upcoming events yet</p>
          <p className="text-xs text-muted-foreground">
            {canPost
              ? "Post an open run or session so players can find and join it here."
              : "Check back soon — runs, clinics and tournaments posted here will show up."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((g) => (
            <EventRow key={g.id} game={g} />
          ))}
        </ul>
      )}
    </section>
  );
}

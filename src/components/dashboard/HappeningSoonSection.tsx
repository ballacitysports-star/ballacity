import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { GameDistance } from "@/components/GameDistance";
import { FacilityLink, useFacilityName } from "@/components/venue/VenueBadge";
import {
  CarouselItem,
  DashboardCarousel,
  DashboardSection,
} from "@/components/dashboard/DashboardSection";
import { useParentMode } from "@/hooks/use-parent-mode";
import { supabase } from "@/integrations/supabase/client";
import {
  happeningSoonBadge,
  soonPriceLabel,
  soonSpotsLabel,
  soonWhenLabel,
  type HappeningSoon,
} from "@/lib/curated-dashboard";
import { isUuid } from "@/lib/game-flow-status";
import { useLiveParticipantCount } from "@/lib/game-participants-store";
import { useIsJoined } from "@/lib/games-store";
import { useJoinGate } from "@/lib/live-status";
import { SPORTS, type Game } from "@/lib/sample-data";
import { getSpotsUrgency, type SpotsUrgency } from "@/lib/spots-urgency";

const SPOTS_TONE: Record<SpotsUrgency, string> = {
  full: "bg-destructive text-destructive-foreground",
  critical: "bg-coral text-white",
  low: "bg-amber-500/90 text-white",
  normal: "bg-lime text-primary-foreground",
};

/**
 * Whether the host reviews requests, so the button can say "Request Spot" or
 * "Join Run". Hosts approve by default, so anything we can't read (no settings
 * row, a demo game, a blocked read) is treated as request-to-join. One small
 * cached read per run.
 */
function useRequiresApproval(gameId: string): boolean {
  const { data } = useQuery({
    queryKey: ["game-requires-approval", gameId],
    enabled: isUuid(gameId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("game_payment_settings")
        .select("requires_approval")
        .eq("game_id", gameId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? !!data.requires_approval : true;
    },
  });
  return data ?? true;
}

function HappeningSoonCard({ game, now }: { game: Game; now: number }) {
  const { isParentMode } = useParentMode();
  const joinedByMe = useIsJoined(game.id);
  const liveCount = useLiveParticipantCount(game.id);
  const joinedCount = Math.min(
    game.maxPlayers,
    (liveCount ?? game.joined) + (joinedByMe && liveCount === undefined ? 1 : 0),
  );
  const spotsLeft = Math.max(0, game.maxPlayers - joinedCount);
  const gate = useJoinGate(game, { spotsLeft });
  const requiresApproval = useRequiresApproval(game.id);
  const facility = useFacilityName(game.orgId).data;
  const emoji = SPORTS.find((s) => s.name === game.sport)?.emoji ?? "🏅";

  // The game page runs the real approval / payment / age checks; this button
  // is the one tap that gets there.
  const open = !gate.locked && !joinedByMe;
  const action = isParentMode
    ? "View run"
    : joinedByMe
      ? "You're in"
      : gate.locked
        ? gate.waitlistOpen
          ? "Join waitlist"
          : gate.label
        : requiresApproval
          ? "Request Spot"
          : "Join Run";

  return (
    <div className="flex w-full flex-col gap-2.5 rounded-2xl border border-border bg-surface p-3.5">
      <Link
        to="/games/$gameId"
        params={{ gameId: game.id }}
        className="block min-w-0 hover:opacity-80"
      >
        <div
          className="flex flex-wrap items-center gap-x-1.5 text-sm font-bold"
          suppressHydrationWarning
        >
          <span aria-hidden>{emoji}</span>
          <span>{game.sport}</span>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="text-lime">{soonWhenLabel(game, now)}</span>
        </div>
        <h3 className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{game.title}</h3>
      </Link>

      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {facility ? (
          <FacilityLink orgId={facility.id} name={facility.name} verified={facility.verified} />
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-coral" />
            <span className="truncate">{game.location}</span>
          </span>
        )}
        <span className="inline-flex shrink-0 items-center gap-1">
          <span aria-hidden>·</span>
          <GameDistance game={game} />
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${SPOTS_TONE[getSpotsUrgency(spotsLeft, game.maxPlayers)]}`}
        >
          {soonSpotsLabel(spotsLeft, game.maxPlayers)}
        </span>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold">
          {soonPriceLabel(game.price)}
        </span>
      </div>

      <Link
        to="/games/$gameId"
        params={{ gameId: game.id }}
        className={`mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-full px-4 text-sm font-bold transition-colors ${
          open && !isParentMode
            ? "bg-lime-gradient text-primary-foreground glow-lime"
            : "border border-border bg-background text-foreground hover:border-lime/40"
        }`}
      >
        {action}
      </Link>
    </div>
  );
}

/**
 * Section 1 of the dashboard: open runs in the next 24–48 hours, soonest
 * first, so a player can fill a last-minute spot in one tap. Renders nothing
 * when there are none.
 */
export function HappeningSoonSection({ soon, now }: { soon: HappeningSoon; now: number }) {
  if (soon.games.length === 0) return null;
  const badge = happeningSoonBadge(soon);
  return (
    <DashboardSection
      id="happening-soon"
      emoji="🔥"
      title="Happening Soon"
      badge={
        badge ? (
          <span className="rounded-full bg-coral px-2 py-0.5 text-[11px] font-bold text-white">
            {badge}
          </span>
        ) : null
      }
    >
      <DashboardCarousel label="Runs happening in the next 48 hours">
        {soon.games.map((g) => (
          <CarouselItem key={g.id}>
            <HappeningSoonCard game={g} now={now} />
          </CarouselItem>
        ))}
      </DashboardCarousel>
    </DashboardSection>
  );
}

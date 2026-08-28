import { ageRequirementLabel } from "@/lib/game-age";
import type { CSSProperties } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { MapPin, Users, Clock, Zap, Lock, Flame, MessageCircle, CalendarDays } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { SpotsPill } from "@/components/SpotsPill";
import type { Game } from "@/lib/sample-data";
import { formatGameWhen } from "@/lib/format";
import { useIsJoined } from "@/lib/games-store";
import { useLiveParticipantCount } from "@/lib/game-participants-store";
import { useLiveStatus, useJoinGate } from "@/lib/live-status";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { toast } from "sonner";
import { useMyFlowStatus, isUuid } from "@/lib/game-flow-status";
import { PlayerFlowPill } from "@/components/PlayerFlowPill";
import { Distance } from "@/components/Distance";
import { JoinBlockedReason } from "@/components/JoinBlockedReason";
import { ResponsiveImage } from "@/components/ResponsiveImage";

const sportEmoji: Record<string, string> = {
  Basketball: "🏀",
  Soccer: "⚽",
  Pickleball: "🏓",
  Volleyball: "🏐",
  Tennis: "🎾",
  "Football": "🏈",
  Baseball: "⚾",
  Softball: "🥎",
  Running: "🏃",
};

export function GameCard({ game, index = 0 }: { game: Game; index?: number }) {
  const joinedByMe = useIsJoined(game.id);
  const liveCount = useLiveParticipantCount(game.id);
  const baseJoined = liveCount ?? game.joined;
  const joinedCount = Math.min(game.maxPlayers, baseJoined + (joinedByMe && liveCount === undefined ? 1 : 0));
  const spotsLeft = game.maxPlayers - joinedCount;
  const fillPct = Math.round((joinedCount / game.maxPlayers) * 100);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [opening, setOpening] = useState(false);
  const hostUserId = (game as { hostUserId?: string }).hostUserId;
  const liveStatus = useLiveStatus(game);
  const gate = useJoinGate(game, { spotsLeft });
  const { status: flowStatus } = useMyFlowStatus(user && isUuid(game.id) ? game.id : undefined);
  const goToHost = (e: React.MouseEvent) => {
    if (!hostUserId) return;
    e.preventDefault();
    e.stopPropagation();
    navigate({ to: "/players/$userId", params: { userId: hostUserId } });
  };
  const messageHost = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!hostUserId) return;
    if (!user) {
      toast.error("Sign in to message the host.");
      return;
    }
    if (hostUserId === user.id) {
      navigate({ to: "/messages" });
      return;
    }
    setOpening(true);
    try {
      const id = await getOrCreateDirectConversation(hostUserId, game.id);
      navigate({ to: "/messages/$conversationId", params: { conversationId: id } });
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't open chat");
    } finally {
      setOpening(false);
    }
  };


  return (
    <div className="enter-up" style={{ "--enter-delay": `${index * 50}ms` } as CSSProperties}>
      <Link
        to="/games/$gameId"
        params={{ gameId: game.id }}
        className="group block overflow-hidden rounded-3xl border border-border bg-surface transition-all hover:border-lime/40 hover:-translate-y-0.5"
      >
        <div className="relative h-28 overflow-hidden">
          <ResponsiveImage
            src={game.image}
            alt={game.title}
            aspect={16 / 9}
            widths={[320, 480, 640, 960]}
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw"
            baseWidth={640}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent" />
          <div className="absolute top-2 left-2 flex flex-wrap gap-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-background/70 backdrop-blur px-2 py-0.5 text-[11px] font-semibold">
              <span>{sportEmoji[game.sport]}</span>
              {game.sport}
            </span>
            {(game.seriesCount ?? 0) > 1 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-background/70 backdrop-blur px-2 py-0.5 text-[11px] font-semibold text-lime">
                <CalendarDays className="h-3 w-3" /> Multi-day · {game.seriesCount} sessions
              </span>
            )}
            {game.urgent && spotsLeft > 0 && !gate.locked && (
              <span className="inline-flex items-center gap-1 rounded-full bg-coral-gradient px-2 py-0.5 text-[11px] font-bold text-white">
                <Zap className="h-3 w-3" /> Needs players
              </span>
            )}
            {flowStatus !== "none" ? (
              <PlayerFlowPill status={flowStatus} short />
            ) : joinedByMe ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-lime px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                Joined
              </span>
            ) : null}
            {game.trending && !game.urgent && liveStatus === "scheduled" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-background/70 backdrop-blur px-2 py-0.5 text-[11px] font-semibold text-coral">
                <Flame className="h-3 w-3" /> Trending
              </span>
            )}
            {gate.joinState === "in_progress" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-coral px-2 py-0.5 text-[11px] font-bold text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> In progress
              </span>
            )}
            {liveStatus === "completed" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-background/70 backdrop-blur px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                Completed
              </span>
            )}
            {(gate.joinState === "closed_by_host" ||
              gate.joinState === "closed_cutoff" ||
              gate.joinState === "roster_full") && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-background/70 backdrop-blur px-2 py-0.5 text-[11px] font-semibold"
                title={gate.reason}
              >
                <Lock className="h-3 w-3" /> {gate.label}
              </span>
            )}
          </div>
          <div className="absolute top-2 right-2">
            {game.price === 0 ? (
              <span className="rounded-full bg-lime px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                FREE
              </span>
            ) : (
              <span className="rounded-full bg-background/70 backdrop-blur px-2 py-0.5 text-[11px] font-bold">
                ${game.price}
              </span>
            )}
          </div>
          <div className="absolute bottom-2 left-3 right-3">
            <h3 className="font-display text-lg font-bold text-foreground drop-shadow-lg">
              {game.title}
            </h3>
          </div>
        </div>

        <div className="p-3 space-y-2">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5" suppressHydrationWarning>
              <Clock className="h-3.5 w-3.5 text-lime" />
              {formatGameWhen(game)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-coral" />
              <Distance mi={game.distanceMi} />
            </span>
            {game.isPrivate && <Lock className="h-3.5 w-3.5" />}
          </div>
          {game.positionsNeeded && Object.keys(game.positionsNeeded).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {Object.entries(game.positionsNeeded).slice(0, 3).map(([name, count]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-full border border-lime/40 bg-lime/10 px-1.5 py-0.5 text-[9px] font-semibold text-lime"
                >
                  {name} <span className="tabular-nums opacity-80">×{count}</span>
                </span>
              ))}
              {Object.keys(game.positionsNeeded).length > 3 && (
                <span className="text-[9px] font-semibold text-muted-foreground">
                  +{Object.keys(game.positionsNeeded).length - 3} more
                </span>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {hostUserId ? (
                <button
                  type="button"
                  onClick={goToHost}
                  className="shrink-0 rounded-full hover:ring-2 hover:ring-lime"
                  aria-label={`View ${game.host.name}'s profile`}
                >
                  <UserAvatar
                    initials={game.host.avatar}
                    name={game.host.name}
                    size="xs"
                  />
                </button>
              ) : (
                <UserAvatar initials={game.host.avatar} name={game.host.name} size="xs" />
              )}

              {hostUserId ? (
                <button
                  type="button"
                  onClick={goToHost}
                  className="truncate font-semibold text-foreground hover:text-lime hover:underline"
                >
                  {game.host.name}
                </button>
              ) : (
                <span className="truncate">{game.host.name}</span>
              )}
              <span className="shrink-0 text-foreground">· {game.skill}</span>
              {ageRequirementLabel({ minAge: game.minAge, maxAge: game.maxAge }) && (
                <span className="shrink-0 text-muted-foreground">
                  · 🎂 {ageRequirementLabel({ minAge: game.minAge, maxAge: game.maxAge })}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {hostUserId && (
                <button
                  type="button"
                  onClick={messageHost}
                  disabled={opening}
                  aria-label={`Message ${game.host.name}`}
                  className="grid h-7 w-7 place-items-center rounded-full border border-border bg-surface text-muted-foreground hover:border-lime/40 hover:text-lime disabled:opacity-50"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                </button>
              )}
              <div className="flex items-center gap-1 text-[11px] font-semibold">
                <Users className="h-3.5 w-3.5 text-lime" />
                <span key={joinedCount} className="text-foreground inline-block motion-safe:animate-scale-in">
                  {joinedCount}/{game.maxPlayers}
                </span>
                {spotsLeft < game.maxPlayers && spotsLeft <= Math.max(3, Math.ceil(game.maxPlayers * 0.2)) && (
                  <SpotsPill spotsLeft={spotsLeft} maxPlayers={game.maxPlayers} />
                )}
              </div>
            </div>
          </div>
          {!joinedByMe && <JoinBlockedReason gate={gate} waitlistHint />}
          {!joinedByMe && flowStatus === "none" && gate.waitlistOpen && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigate({
                  to: "/games/$gameId",
                  params: { gameId: game.id },
                  hash: "waitlist",
                });
              }}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-lime/40 bg-lime/10 px-3 py-1.5 text-[11px] font-bold text-lime transition-colors hover:bg-lime/20"
            >
              <Users className="h-3.5 w-3.5" /> Join waitlist
            </button>
          )}
          <div className="h-1 overflow-hidden rounded-full bg-secondary">
            <div
              className={`grow-x h-full rounded-full ${spotsLeft <= 2 ? "bg-coral-gradient" : "bg-lime-gradient"}`}
              style={
                {
                  width: `${fillPct}%`,
                  "--enter-delay": `${100 + index * 50}ms`,
                } as CSSProperties
              }
            />
          </div>
        </div>
      </Link>
    </div>
  );
}

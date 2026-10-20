import { VenueBadge } from "@/components/venue/VenueBadge";
import { MediaImage } from "@/components/MediaImage";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { MapPin, Users, Clock, Lock, CalendarDays } from "lucide-react";
import type { Game } from "@/lib/sample-data";
import { formatGameWhen } from "@/lib/format";
import { useIsJoined } from "@/lib/games-store";
import { useLiveParticipantCount } from "@/lib/game-participants-store";
import { useJoinGate } from "@/lib/live-status";
import { GamePlaceDistance } from "@/components/GameDistance";

const sportEmoji: Record<string, string> = {
  Basketball: "🏀",
  Soccer: "⚽",
  Pickleball: "🏓",
  Volleyball: "🏐",
  Tennis: "🎾",
  Football: "🏈",
  Baseball: "⚾",
  Softball: "🥎",
  Running: "🏃",
};

export function GameListRow({ game, index = 0 }: { game: Game; index?: number }) {
  const joinedByMe = useIsJoined(game.id);
  const liveCount = useLiveParticipantCount(game.id);
  const baseJoined = liveCount ?? game.joined;
  const joinedCount = Math.min(
    game.maxPlayers,
    baseJoined + (joinedByMe && liveCount === undefined ? 1 : 0),
  );
  const spotsLeft = game.maxPlayers - joinedCount;
  const gate = useJoinGate(game, { spotsLeft });
  const liveStatus = gate.liveStatus;

  const statusLabel =
    liveStatus === "in_progress"
      ? "In progress"
      : liveStatus === "completed"
        ? "Done"
        : joinedByMe
          ? "Joined"
          : gate.locked
            ? gate.label
            : game.price > 0
              ? `$${game.price}`
              : "Free";
  const statusTone =
    liveStatus === "in_progress"
      ? "bg-coral text-white"
      : liveStatus === "completed"
        ? "bg-surface border border-border text-muted-foreground"
        : joinedByMe
          ? "bg-lime/15 text-lime border border-lime/40"
          : gate.locked || spotsLeft <= 0
            ? "bg-surface border border-border text-muted-foreground"
            : game.price > 0
              ? "bg-lime-gradient text-primary-foreground"
              : "bg-lime text-primary-foreground";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.2) }}
    >
      <Link
        to="/games/$gameId"
        params={{ gameId: game.id }}
        className="group flex min-h-[4.5rem] items-center gap-3 rounded-2xl border border-border bg-surface p-2 pr-3 transition-all hover:border-lime/40"
      >
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl">
          <MediaImage
            src={game.image}
            alt={game.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
          <span className="absolute bottom-0.5 left-0.5 rounded-full bg-background/80 px-1 text-[10px] leading-4">
            {sportEmoji[game.sport] ?? "🏅"}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate font-display text-sm font-bold">{game.title}</h3>
            {(game.seriesCount ?? 0) > 1 && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-lime/15 px-1.5 py-0.5 text-[9px] font-bold text-lime">
                <CalendarDays className="h-2.5 w-2.5" /> {game.seriesCount} days
              </span>
            )}
            {game.isPrivate && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1" suppressHydrationWarning>
              <Clock className="h-3 w-3 text-lime" />
              {formatGameWhen(game)}
            </span>
            <span className="inline-flex items-center gap-1 truncate">
              <MapPin className="h-3 w-3 text-coral" />
              <GamePlaceDistance game={game} />
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Users className="h-3 w-3 text-lime" />
              {joinedCount}/{game.maxPlayers}
            </span>
          </div>
          {game.orgId && (
            <div className="mt-1 flex min-w-0">
              <VenueBadge orgId={game.orgId} />
            </div>
          )}
        </div>

        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-bold ${statusTone}`}
        >
          {statusLabel}
        </span>
      </Link>
    </motion.div>
  );
}

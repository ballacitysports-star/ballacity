import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { MapPin, Clock, Check, X as XIcon, Clock as ClockIcon, User } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { SpotsPill } from "@/components/SpotsPill";
import type { Game } from "@/lib/sample-data";
import { formatWhen } from "@/lib/format";
import { useLiveParticipantCount } from "@/lib/game-participants-store";
import type { JoinRequest } from "@/lib/payments";

const sportEmoji: Record<string, string> = {
  Basketball: "🏀",
  Soccer: "⚽",
  Pickleball: "🥒",
  Volleyball: "🏐",
  Tennis: "🎾",
  Football: "🏈",
  Baseball: "⚾",
  Softball: "🥎",
  Running: "🏃",
};

export function RequestGameCard({
  game,
  request,
  index = 0,
  isHost,
  onCancel,
  onApprove,
  onDecline,
}: {
  game: Game;
  request: JoinRequest;
  index?: number;
  isHost?: boolean;
  onCancel?: () => void;
  onApprove?: () => void;
  onDecline?: () => void;
}) {
  const isPending = request.status === "pending";
  const isApproved = request.status === "approved";
  const liveCount = useLiveParticipantCount(game.id);
  const joinedCount = liveCount ?? game.joined;
  const spotsLeft = Math.max(0, game.maxPlayers - joinedCount);
  const fillPct = Math.round((joinedCount / game.maxPlayers) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, type: "spring", stiffness: 180, damping: 22 }}
    >
      <div
        className={`overflow-hidden rounded-3xl border bg-surface transition-all hover:border-lime/40 hover:-translate-y-0.5 ${
          isPending ? "border-coral/40" : isApproved ? "border-lime/40" : "border-border"
        }`}
      >
        <Link
          to="/games/$gameId"
          params={{ gameId: game.id }}
          className="group block"
        >
          <div className="relative h-44 overflow-hidden">
            <img
              src={game.image}
              alt={game.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent" />
            <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-background/70 backdrop-blur px-2.5 py-1 text-xs font-semibold">
                <span>{sportEmoji[game.sport]}</span>
                {game.sport}
              </span>
            </div>
            <div className="absolute top-3 right-3">
              {game.price === 0 ? (
                <span className="rounded-full bg-lime px-2.5 py-1 text-xs font-bold text-primary-foreground">
                  FREE
                </span>
              ) : (
                <span className="rounded-full bg-background/70 backdrop-blur px-2.5 py-1 text-xs font-bold">
                  ${game.price}
                </span>
              )}
            </div>
            <div className="absolute bottom-3 left-3 right-3">
              <h3 className="font-display text-xl font-bold text-foreground drop-shadow-lg">
                {game.title}
              </h3>
            </div>
          </div>

          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5" suppressHydrationWarning>
                <Clock className="h-4 w-4 text-lime" />
                {formatWhen(game.date)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-coral" />
                {game.distanceMi} mi
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <UserAvatar initials={game.host.avatar} name={game.host.name} size="xs" />
                <span>{game.host.name}</span>
                <span className="text-foreground">· {game.skill}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <span className="text-foreground">
                  {joinedCount}/{game.maxPlayers}
                </span>
                {spotsLeft < game.maxPlayers && spotsLeft <= Math.max(3, Math.ceil(game.maxPlayers * 0.2)) && (
                  <SpotsPill spotsLeft={spotsLeft} maxPlayers={game.maxPlayers} />
                )}
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${fillPct}%` }}
                transition={{ duration: 0.8, delay: 0.1 + index * 0.05 }}
                className={`h-full rounded-full ${spotsLeft <= 2 ? "bg-coral-gradient" : "bg-lime-gradient"}`}
              />
            </div>
          </div>
        </Link>

        <div
          className={`mx-4 mb-4 rounded-2xl border p-3 flex items-start gap-3 ${
            isPending
              ? "border-coral/40 bg-coral/10"
              : isApproved
                ? "border-lime/40 bg-lime/10"
                : "border-border bg-surface"
          }`}
        >
          {isPending ? (
            <ClockIcon className="h-4 w-4 text-coral shrink-0 mt-0.5" />
          ) : isApproved ? (
            <Check className="h-4 w-4 text-lime shrink-0 mt-0.5" />
          ) : (
            <XIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">
              {isHost
                ? isPending
                  ? "A player wants to join"
                  : isApproved
                    ? "You approved this player."
                    : "You declined this player."
                : isPending
                  ? "Waiting for host approval"
                  : isApproved
                    ? "Approved — you're on the roster."
                    : "Declined by host."}
            </p>
            {isPending && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Requested {new Date(request.created_at).toLocaleDateString()}
              </p>
            )}
          </div>
          {isPending && (
            <div className="flex items-center gap-2">
              {isHost && onDecline && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDecline();
                  }}
                  className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold hover:border-coral/40"
                >
                  Decline
                </button>
              )}
              {isHost && onApprove && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onApprove();
                  }}
                  className="rounded-full bg-lime-gradient px-3 py-1 text-xs font-semibold text-primary-foreground"
                >
                  Approve
                </button>
              )}
              {!isHost && onCancel && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onCancel();
                  }}
                  className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold hover:border-coral/40"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

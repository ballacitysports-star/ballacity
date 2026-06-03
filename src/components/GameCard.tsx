import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { MapPin, Users, Clock, Zap, Lock, Flame } from "lucide-react";
import type { Game } from "@/lib/sample-data";
import { formatWhen } from "@/lib/format";
import { useIsJoined } from "@/lib/games-store";

const sportEmoji: Record<string, string> = {
  Basketball: "🏀", Soccer: "⚽", Pickleball: "🥒", Volleyball: "🏐",
  Tennis: "🎾", "Flag Football": "🏈", Baseball: "⚾", Softball: "🥎",
  Hockey: "🏒", Running: "🏃",
};

export function GameCard({ game, index = 0 }: { game: Game; index?: number }) {
  const joinedByMe = useIsJoined(game.id);
  const joinedCount = Math.min(game.maxPlayers, game.joined + (joinedByMe ? 1 : 0));
  const spotsLeft = game.maxPlayers - joinedCount;
  const fillPct = Math.round((joinedCount / game.maxPlayers) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, type: "spring", stiffness: 180, damping: 22 }}
    >
      <Link
        to="/games/$gameId"
        params={{ gameId: game.id }}
        className="group block overflow-hidden rounded-3xl border border-border bg-surface transition-all hover:border-lime/40 hover:-translate-y-0.5"
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
              <span>{sportEmoji[game.sport]}</span>{game.sport}
            </span>
            {game.urgent && (
              <span className="inline-flex items-center gap-1 rounded-full bg-coral-gradient px-2.5 py-1 text-xs font-bold text-white">
                <Zap className="h-3 w-3" /> Needs players
              </span>
            )}
            {joinedByMe && (
              <span className="inline-flex items-center gap-1 rounded-full bg-lime px-2.5 py-1 text-xs font-bold text-primary-foreground">
                Joined
              </span>
            )}
            {game.trending && !game.urgent && (
              <span className="inline-flex items-center gap-1 rounded-full bg-background/70 backdrop-blur px-2.5 py-1 text-xs font-semibold text-coral">
                <Flame className="h-3 w-3" /> Trending
              </span>
            )}
          </div>
          <div className="absolute top-3 right-3">
            {game.price === 0 ? (
              <span className="rounded-full bg-lime px-2.5 py-1 text-xs font-bold text-primary-foreground">FREE</span>
            ) : (
              <span className="rounded-full bg-background/70 backdrop-blur px-2.5 py-1 text-xs font-bold">${game.price}</span>
            )}
          </div>
          <div className="absolute bottom-3 left-3 right-3">
            <h3 className="font-display text-xl font-bold text-foreground drop-shadow-lg">{game.title}</h3>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5" suppressHydrationWarning><Clock className="h-4 w-4 text-lime" />{formatWhen(game.date)}</span>
            <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-coral" />{game.distanceMi} mi</span>
            {game.isPrivate && <Lock className="h-4 w-4" />}
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-secondary text-[10px] font-bold">
                {game.host.avatar}
              </span>
              <span>{game.host.name}</span>
              <span className="text-foreground">· {game.skill}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Users className="h-4 w-4 text-lime" />
              <span className="text-foreground">{joinedCount}/{game.maxPlayers}</span>
              {spotsLeft > 0 && spotsLeft <= 3 && (
                <span className="text-coral">· {spotsLeft} left</span>
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
    </motion.div>
  );
}

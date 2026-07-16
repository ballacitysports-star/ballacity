import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { MapPin, Users, Clock, Zap, Lock, Flame, MessageCircle, Check, CreditCard } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { SpotsPill } from "@/components/SpotsPill";
import type { Game } from "@/lib/sample-data";
import { formatWhen } from "@/lib/format";
import { joinGame, useIsJoined } from "@/lib/games-store";
import { useLiveParticipantCount } from "@/lib/game-participants-store";
import { useLiveStatus } from "@/lib/live-status";
import { getOrCreateDirectConversation } from "@/lib/messages";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { toast } from "sonner";
import { useMyFlowStatus, isUuid } from "@/lib/game-flow-status";
import { PlayerFlowPill } from "@/components/PlayerFlowPill";

const sportEmoji: Record<string, string> = {
  Basketball: "🏀",
  Soccer: "⚽",
  Pickleball: "🥒",
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
  const { status: flowStatus } = useMyFlowStatus(user ? game.id : undefined);
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

  // Quick-join for free games where the viewer clearly can join: signed in,
  // spots available, not already joined, not the host, game still scheduled.
  // Paid or approval-gated games still route through the details page so the
  // player can review the fee / request-to-join copy before committing.
  const canQuickJoin =
    !!user &&
    !joinedByMe &&
    game.price === 0 &&
    spotsLeft > 0 &&
    liveStatus === "scheduled" &&
    !game.joinsClosed &&
    (!hostUserId || hostUserId !== user.id);
  const quickJoin = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    joinGame(game.id);
    toast.success(`You're in! See you at ${game.location}.`);
  };
  const ctaLabel =
    joinedByMe
      ? "You're in"
      : liveStatus === "completed"
        ? "Completed"
        : liveStatus === "in_progress"
          ? "Live now"
          : spotsLeft <= 0
            ? "Full"
            : game.price > 0
              ? `Pay $${game.price}`
              : user
                ? "Join free"
                : "Sign in to join";

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
              <span>{sportEmoji[game.sport]}</span>
              {game.sport}
            </span>
            {game.urgent && (
              <span className="inline-flex items-center gap-1 rounded-full bg-coral-gradient px-2.5 py-1 text-xs font-bold text-white">
                <Zap className="h-3 w-3" /> Needs players
              </span>
            )}
            {flowStatus !== "none" ? (
              <PlayerFlowPill status={flowStatus} short />
            ) : joinedByMe ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-lime px-2.5 py-1 text-xs font-bold text-primary-foreground">
                Joined
              </span>
            ) : null}
            {game.trending && !game.urgent && liveStatus === "scheduled" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-background/70 backdrop-blur px-2.5 py-1 text-xs font-semibold text-coral">
                <Flame className="h-3 w-3" /> Trending
              </span>
            )}
            {liveStatus === "in_progress" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-coral px-2.5 py-1 text-xs font-bold text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> Live
              </span>
            )}
            {liveStatus === "completed" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-background/70 backdrop-blur px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                Completed
              </span>
            )}
            {game.joinsClosed && liveStatus === "scheduled" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-background/70 backdrop-blur px-2.5 py-1 text-xs font-semibold">
                <Lock className="h-3 w-3" /> Closed
              </span>
            )}
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
            {game.isPrivate && <Lock className="h-4 w-4" />}
          </div>
          {game.positionsNeeded && Object.keys(game.positionsNeeded).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {Object.entries(game.positionsNeeded).slice(0, 3).map(([name, count]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-full border border-lime/40 bg-lime/10 px-2 py-0.5 text-[10px] font-semibold text-lime"
                >
                  {name} <span className="tabular-nums opacity-80">×{count}</span>
                </span>
              ))}
              {Object.keys(game.positionsNeeded).length > 3 && (
                <span className="text-[10px] font-semibold text-muted-foreground">
                  +{Object.keys(game.positionsNeeded).length - 3} more
                </span>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {hostUserId ? (
                <button
                  type="button"
                  onClick={goToHost}
                  className="rounded-full hover:ring-2 hover:ring-lime"
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
                  className="font-semibold text-foreground hover:text-lime hover:underline"
                >
                  {game.host.name}
                </button>
              ) : (
                <span>{game.host.name}</span>
              )}
              <span className="text-foreground">· {game.skill}</span>
            </div>
            <div className="flex items-center gap-2">
              {hostUserId && (
                <button
                  type="button"
                  onClick={messageHost}
                  disabled={opening}
                  aria-label={`Message ${game.host.name}`}
                  className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-muted-foreground hover:border-lime/40 hover:text-lime disabled:opacity-50"
                >
                  <MessageCircle className="h-4 w-4" />
                </button>
              )}
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <Users className="h-4 w-4 text-lime" />
                <span key={joinedCount} className="text-foreground inline-block motion-safe:animate-scale-in">
                  {joinedCount}/{game.maxPlayers}
                </span>
                {spotsLeft < game.maxPlayers && spotsLeft <= Math.max(3, Math.ceil(game.maxPlayers * 0.2)) && (
                  <SpotsPill spotsLeft={spotsLeft} maxPlayers={game.maxPlayers} />
                )}
              </div>
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
          {canQuickJoin ? (
            <button
              type="button"
              onClick={quickJoin}
              className="mt-1 w-full rounded-2xl bg-lime-gradient py-2.5 text-sm font-bold text-primary-foreground glow-lime inline-flex items-center justify-center gap-1.5"
            >
              {ctaLabel}
            </button>
          ) : (
            <div
              className={`mt-1 w-full rounded-2xl py-2.5 text-sm font-bold inline-flex items-center justify-center gap-1.5 ${
                joinedByMe
                  ? "bg-lime/15 border border-lime/40 text-lime"
                  : spotsLeft <= 0 || liveStatus === "completed"
                    ? "border border-border bg-surface text-muted-foreground"
                    : liveStatus === "in_progress"
                      ? "bg-coral/15 border border-coral/40 text-coral"
                      : game.price > 0
                        ? "bg-lime-gradient text-primary-foreground glow-lime"
                        : "border border-border bg-surface text-foreground"
              }`}
            >
              {joinedByMe && <Check className="h-4 w-4" />}
              {!joinedByMe && game.price > 0 && spotsLeft > 0 && liveStatus === "scheduled" && (
                <CreditCard className="h-4 w-4" />
              )}
              {ctaLabel}
            </div>
          )}
        </div>
      </Link>
    </motion.div>
  );
}

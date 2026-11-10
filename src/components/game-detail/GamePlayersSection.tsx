import { SpotsPill } from "@/components/SpotsPill";
import { Clock } from "lucide-react";
import { HostPendingChip } from "@/components/game-detail/HostRequestRows";
import { motion } from "framer-motion";
import { UserAvatarById } from "@/components/UserAvatar";
import { Link } from "@tanstack/react-router";
import { RosterRecruitPanel } from "@/components/players/RosterRecruitPanel";
import { type Game } from "@/lib/sample-data";
import { type RosterEntry } from "@/components/game-detail/game-roster-entry";
import { type LiveParticipant } from "@/lib/game-roster";

export type GamePlayersSectionProps = {
  applyOptimisticReview: (reqId: string, status: "approved" | "rejected") => () => void;
  effectiveJoined: number;
  game: Game;
  isHost: boolean;
  liveRoster: LiveParticipant[];
  meId: string | null;
  pendingCount: number;
  players: RosterEntry[];
  spotsLeft: number;
  viewerPending: boolean;
};

export function GamePlayersSection({
  applyOptimisticReview,
  effectiveJoined,
  game,
  isHost,
  liveRoster,
  meId,
  pendingCount,
  players,
  spotsLeft,
  viewerPending,
}: GamePlayersSectionProps) {
  return (
    <>
      {/* Players */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-2">
          <h2 className="section-eyebrow text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>
              Roster (
              <span
                key={effectiveJoined}
                className="inline-block motion-safe:animate-scale-in tabular-nums"
              >
                {effectiveJoined}
              </span>
              /{game.maxPlayers})
            </span>
            <SpotsPill spotsLeft={spotsLeft} maxPlayers={game.maxPlayers} />
            {(viewerPending || pendingCount > 0) && (
              <span className="inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/10 px-2 py-0.5 text-[10px] font-bold text-coral normal-case tracking-normal">
                <Clock className="h-3 w-3" />
                {viewerPending ? "You're pending" : `${pendingCount} pending`}
              </span>
            )}
          </h2>
          <button className="text-xs font-semibold text-lime">See all</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {players.map((p, i) => {
            if (p.kind === "hostPending") {
              return (
                <HostPendingChip
                  key={`pending-${p.req.id}`}
                  req={p.req}
                  gameTitle={game.title}
                  onOptimistic={applyOptimisticReview}
                  index={i}
                />
              );
            }
            const linkableUserId = p.kind === "player" ? p.userId : undefined;
            const chip = (
              <motion.div
                key={i}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.04 }}
                title={
                  p.pending
                    ? "Pending host approval"
                    : p.kind === "player" && p.displayName
                      ? p.displayName
                      : undefined
                }
                className={`relative grid h-11 w-11 place-items-center overflow-hidden rounded-full border text-xs font-bold ${
                  p.pending
                    ? "border-dashed border-coral/60 bg-coral/10 text-coral"
                    : p.isMe
                      ? "border-lime bg-lime/15 text-lime"
                      : "border-border bg-surface"
                } ${linkableUserId ? "cursor-pointer transition-transform hover:scale-105" : ""}`}
              >
                {p.kind === "player" && linkableUserId ? (
                  <UserAvatarById
                    userId={linkableUserId}
                    avatarUrl={p.avatarUrl ?? null}
                    initials={p.initials}
                    name={p.displayName}
                    size="md"
                    className="h-full w-full border-0 rounded-full text-xs"
                  />
                ) : p.kind === "player" && p.avatarUrl ? (
                  <img
                    src={p.avatarUrl}
                    alt={p.displayName ?? p.initials}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  p.initials
                )}
                {p.pending && (
                  <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-coral-strong text-[8px] text-white">
                    <Clock className="h-2.5 w-2.5" />
                  </span>
                )}
              </motion.div>
            );
            if (linkableUserId) {
              return (
                <Link
                  key={i}
                  to="/players/$userId"
                  params={{ userId: linkableUserId }}
                  className="focus:outline-none focus-visible:ring-2 focus-visible:ring-lime rounded-full"
                >
                  {chip}
                </Link>
              );
            }
            return chip;
          })}
          {Array.from({
            length: Math.max(0, spotsLeft - (viewerPending ? 1 : 0) - pendingCount),
          }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="grid h-11 w-11 place-items-center rounded-full border-2 border-dashed border-border bg-transparent text-muted-foreground text-lg"
            >
              +
            </div>
          ))}
        </div>
        {(viewerPending || pendingCount > 0) && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {isHost && pendingCount > 0
              ? "Tap a dashed coral avatar to approve or decline that pickup request."
              : "Dashed coral avatars = awaiting host approval. They don't hold a confirmed spot until approved."}
          </p>
        )}
        <RosterRecruitPanel roster={liveRoster} meId={meId} />
      </div>
    </>
  );
}

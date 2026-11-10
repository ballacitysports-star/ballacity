import { Link } from "@tanstack/react-router";
import { UserAvatarById, UserAvatar } from "@/components/UserAvatar";
import { hostTeamLink, type GameHostTeam } from "@/lib/game-host-team";
import { type ComponentProps } from "react";
import { hostReviewId } from "@/components/game-detail/GameDetailBits";
import { Star } from "lucide-react";
import { ReputationBadge } from "@/components/ReputationBadge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ReviewsSection } from "@/components/ReviewsSection";
import { type GamePaymentSettings } from "@/lib/payments";
import { type Game } from "@/lib/sample-data";
import { type Reputation } from "@/lib/reviews";

export type GameHostSectionProps = {
  canReviewHost: boolean;
  game: Game;
  hostRep: Reputation;
  hostTeam: GameHostTeam | null;
  ownsViaGame: boolean;
  reviewsOpen: boolean;
  setReviewsOpen: (v: boolean) => void;
  settings: GamePaymentSettings | null;
};

export function GameHostSection({
  canReviewHost,
  game,
  hostRep,
  hostTeam,
  ownsViaGame,
  reviewsOpen,
  setReviewsOpen,
  settings,
}: GameHostSectionProps) {
  return (
    <>
      {/* Host */}
      <div className="flex items-center gap-3 rounded-3xl border border-border bg-surface p-4">
        {(() => {
          const hostId = settings?.host_id ?? game.hostUserId;
          const NameTag = (hostId ? Link : "span") as React.ElementType;
          const nameProps = hostId
            ? {
                to: "/players/$userId",
                params: { userId: hostId },
                className: "hover:text-lime hover:underline",
              }
            : {};
          const avatarEl = (
            <UserAvatarById
              userId={hostId}
              avatarUrl={(game as { hostAvatarUrl?: string | null }).hostAvatarUrl ?? null}
              initials={game.host.avatar}
              name={game.host.name}
              size="lg"
              rounded="square"
            />
          );
          if (hostTeam) {
            const link = hostTeamLink(hostTeam) as unknown as ComponentProps<typeof Link>;
            return (
              <>
                <Link {...link} aria-label={`View ${hostTeam.name}`}>
                  <UserAvatar
                    avatarUrl={hostTeam.avatarUrl}
                    initials={hostTeam.initials}
                    name={hostTeam.name}
                    size="lg"
                    rounded="logo"
                  />
                </Link>
                <div className="flex-1 min-w-0">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Hosted by
                  </div>
                  <div className="font-semibold truncate">
                    <Link {...link} className="hover:text-lime hover:underline">
                      {hostTeam.name}
                    </Link>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Organized by <NameTag {...nameProps}>{game.host.name}</NameTag>
                    {game.host.rating ? (
                      <span className="text-lime font-semibold"> · ★ {game.host.rating}</span>
                    ) : null}
                  </div>
                </div>
              </>
            );
          }
          return (
            <>
              {hostId ? (
                <Link
                  to="/players/$userId"
                  params={{ userId: hostId }}
                  aria-label={`View ${game.host.name}'s profile`}
                >
                  {avatarEl}
                </Link>
              ) : (
                avatarEl
              )}
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Hosted by
                </div>
                <div className="font-semibold">
                  <NameTag {...nameProps}>{game.host.name}</NameTag>{" "}
                  <span className="text-muted-foreground font-normal text-sm">
                    {game.host.username}
                  </span>
                </div>
                <div className="text-xs text-lime font-semibold">
                  ★ {game.host.rating} host rating
                </div>
              </div>
            </>
          );
        })()}

        {canReviewHost ? (
          <Link
            to="/review/new"
            search={
              {
                revieweeId: hostReviewId(game),
                revieweeKind: "host",
                revieweeName: game.host.name,
                kind: "player",
                context: game.title,
              } as never
            }
            className="inline-flex items-center gap-1 rounded-full border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-bold text-lime"
          >
            <Star className="h-3 w-3" /> Write review
          </Link>
        ) : null}
      </div>

      {/* Host reputation (opens reviews popup) */}
      {hostRep.count > 0 && (
        <div className="mt-3">
          <ReputationBadge
            rep={hostRep}
            onClick={() => setReviewsOpen(true)}
            ariaLabel={`Open host reviews for ${game.host.name}. Trust score ${hostRep.trustScore}, ${hostRep.avg.toFixed(1)} out of 5 from ${hostRep.count} review${hostRep.count === 1 ? "" : "s"}.`}
          />
        </div>
      )}

      {/* Host reviews popup */}
      <Dialog open={reviewsOpen} onOpenChange={setReviewsOpen}>
        <DialogContent
          className="max-h-[90dvh] w-[min(100%,40rem)] overflow-y-auto p-0"
          aria-labelledby="host-reviews-title"
          aria-describedby="host-reviews-desc"
        >
          <DialogHeader className="sr-only">
            <DialogTitle id="host-reviews-title">Reviews for host {game.host.name}</DialogTitle>
            <DialogDescription id="host-reviews-desc">
              Browse, filter, and sort reviews left for this host. Press Escape to close.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4">
            <ReviewsSection
              revieweeId={hostReviewId(game)}
              revieweeKind="host"
              revieweeName={game.host.name}
              isOwner={ownsViaGame}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

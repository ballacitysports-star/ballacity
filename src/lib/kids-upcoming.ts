import type { ChildActivity, ChildGame } from "@/lib/guardian-activity.functions";

export type KidGame = { game: ChildGame; child: string; childUserId: string };

/**
 * The next games across all of a guardian's children, soonest first: what the
 * parent Home shows above the feed. Games that have already started are left out.
 */
export function nextKidsGames(kids: ChildActivity[], nowMs: number, limit = 3): KidGame[] {
  return kids
    .flatMap((k) => k.upcoming.map((game) => ({ game, child: k.name, childUserId: k.childUserId })))
    .filter(({ game }) => new Date(game.date).getTime() > nowMs)
    .sort((a, b) => new Date(a.game.date).getTime() - new Date(b.game.date).getTime())
    .slice(0, limit);
}

export const KID_GAME_STATUS_LABEL: Record<ChildGame["status"], string> = {
  joined: "Going",
  approved: "Approved",
  requested: "Requested",
};

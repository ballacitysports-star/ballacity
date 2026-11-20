// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Game } from "@/lib/sample-data";
import type { Reputation } from "@/lib/reviews";
import type { GameHostTeam } from "@/lib/game-host-team";

/**
 * The host line on the game page shows the live rating from the host's reviews
 * (liveHostRating), never the publish-time `game.host.rating` snapshot, which
 * defaults to 5: a host with no reviews shows no stars.
 */

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => (
    <a href={to ?? "#"}>{children}</a>
  ),
}));
vi.mock("@/components/UserAvatar", () => ({
  UserAvatar: () => <span data-testid="avatar" />,
  UserAvatarById: () => <span data-testid="avatar" />,
}));
vi.mock("@/components/ReputationBadge", () => ({ ReputationBadge: () => null }));
vi.mock("@/components/ReviewsSection", () => ({ ReviewsSection: () => null }));

import { GameHostSection } from "./GameHostSection";

afterEach(cleanup);

// The snapshot rating is 5, as hosted-games-store.ts stores it when the profile had none.
const game = {
  id: "g-host",
  title: "Friday pickup",
  hostUserId: "host-1",
  host: { name: "Sam Host", username: "@sam", avatar: "SH", rating: 5 },
} as unknown as Game;

const rep = (avg: number, count: number) => ({ avg, count, trustScore: 0 }) as Reputation;

const team: GameHostTeam = {
  id: "team-1",
  name: "Northside Hoops",
  initials: "NH",
  avatarUrl: null,
  kind: "team",
  verified: false,
};

function renderHost(hostRep: Reputation, hostTeam: GameHostTeam | null = null) {
  return render(
    <GameHostSection
      canReviewHost={false}
      game={game}
      hostRep={hostRep}
      hostTeam={hostTeam}
      ownsViaGame={false}
      reviewsOpen={false}
      setReviewsOpen={() => {}}
      settings={null}
    />,
  );
}

const hostLine = () => screen.getByText("Hosted by").parentElement!;

describe("GameHostSection host rating", () => {
  it("shows no stars for a host with no reviews, whatever the snapshot says", () => {
    renderHost(rep(0, 0));
    expect(hostLine().textContent).toContain("Sam Host");
    expect(hostLine().textContent).not.toContain("★");
    expect(hostLine().textContent).not.toMatch(/\b5\b/);
  });

  it("shows the live average and the review count", () => {
    renderHost(rep(4.666, 3));
    expect(hostLine().textContent).toContain("★");
    expect(hostLine().textContent).toContain("4.7");
    expect(hostLine().textContent).toContain("3 reviews");
  });

  it("hosted by a team: no stars without reviews, the live rating with them", () => {
    renderHost(rep(0, 0), team);
    expect(hostLine().textContent).toContain("Organized by");
    expect(hostLine().textContent).not.toContain("★");
    cleanup();
    renderHost(rep(4.666, 3), team);
    expect(hostLine().textContent).toContain("★");
    expect(hostLine().textContent).toContain("4.7");
    expect(hostLine().textContent).toContain("3 reviews");
  });
});

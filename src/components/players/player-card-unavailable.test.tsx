// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// The player card route, rendered on its own: every way getPlayerCard can come back
// without a profile must land on the same screen, so the page never says which.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    options: opts,
    useParams: () => ({ userId: "u1" }),
  }),
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
const getPlayerCard = vi.fn();
const listPublicReels = vi.fn();
vi.mock("@/lib/player-card.functions", () => ({
  getPlayerCard: (args: unknown) => getPlayerCard(args),
}));
vi.mock("@/lib/reels.functions", () => ({
  listPublicReels: (args: unknown) => listPublicReels(args),
}));
vi.mock("@/hooks/use-reel-realtime", () => ({ useReelRealtime: () => {} }));
vi.mock("@/components/InlineVideoPlayer", () => ({ InlineVideoPlayer: () => null }));
vi.mock("@/components/players/PublicXpCard", () => ({ PublicXpCard: () => null }));
vi.mock("@/components/players/ContactGuardianButton", () => ({
  ContactGuardianButton: () => null,
}));
vi.mock("@/components/reels/FamilyClipsSection", () => ({ FamilyClipsSection: () => null }));

// The page's section-tab observer runs once loading ends; jsdom has none.
vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

import { Route } from "@/routes/player-card.$userId";

const PlayerCardPage = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component;

const empty = {
  profile: null,
  games: [],
  stats: { gamesPlayed: 0, gamesHosted: 0, reels: 0, sports: [], upcoming: 0 },
};

afterEach(() => {
  cleanup();
  getPlayerCard.mockReset();
  listPublicReels.mockReset();
});

async function renderUnavailable(answer: () => Promise<unknown>) {
  getPlayerCard.mockImplementation(answer);
  listPublicReels.mockResolvedValue([]);
  const { container } = render(<PlayerCardPage />);
  await screen.findByText("This player card is private or unavailable.");
  return container.innerHTML;
}

describe("player card for a player the viewer may not see", () => {
  it("shows the private-or-unavailable screen, not 'removed'", async () => {
    await renderUnavailable(() => Promise.resolve(empty));
    expect(screen.getByRole("heading", { name: "Player card unavailable" })).toBeTruthy();
    expect(screen.queryByText(/removed|not found/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Find players" }).getAttribute("href")).toBe(
      "/players",
    );
  });

  it("renders identically whether the server hid the player or the call failed", async () => {
    // Nonexistent, non-public, suspended and age-restricted players all come back as
    // profile: null; a failed call is caught to null. One screen for every case.
    const hidden = await renderUnavailable(() => Promise.resolve(empty));
    cleanup();
    const failed = await renderUnavailable(() => Promise.reject(new Error("boom")));
    expect(failed).toBe(hidden);
  });
});

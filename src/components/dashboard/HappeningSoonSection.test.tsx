// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  parentMode: false,
  requiresApproval: true as boolean | null,
  facility: null as null | { id: string; name: string; verified: boolean; amenities: string[] },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}));
vi.mock("@/hooks/use-parent-mode", () => ({
  useParentMode: () => ({ isParentMode: state.parentMode, loading: false }),
}));
vi.mock("@/components/GameDistance", () => ({
  GameDistance: () => <span>2.4 mi</span>,
}));
vi.mock("@/components/venue/VenueBadge", () => ({
  useFacilityName: () => ({ data: state.facility }),
  FacilityLink: ({ name }: { name: string }) => <button type="button">{name}</button>,
}));
vi.mock("@/lib/game-participants-store", () => ({ useLiveParticipantCount: () => undefined }));
vi.mock("@/lib/games-store", () => ({ useIsJoined: () => false }));
vi.mock("@/lib/game-flow-status", () => ({ isUuid: () => true }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({
          data:
            state.requiresApproval === null ? null : { requires_approval: state.requiresApproval },
          error: null,
        }),
      };
      return chain;
    },
  },
}));

import type { Game } from "@/lib/sample-data";
import { buildHappeningSoon } from "@/lib/curated-dashboard";
import { HappeningSoonSection } from "./HappeningSoonSection";

const HOUR = 3_600_000;
const now = Date.now();

function game(over: Partial<Game> & { id: string }): Game {
  return {
    sport: "Basketball",
    title: "Tuesday night run",
    host: { name: "Host", username: "host", avatar: "H", rating: 5 },
    date: new Date(now + 3 * HOUR).toISOString(),
    duration: "90 min",
    location: "Bogan Park",
    neighborhood: "Buford",
    maxPlayers: 10,
    joined: 8,
    skill: "All Levels",
    price: 0,
    indoor: true,
    isPrivate: false,
    image: "",
    description: "",
    equipment: [],
    ...over,
  } as Game;
}

function renderSection(games: Game[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const soon = buildHappeningSoon(games, { now });
  return render(
    <QueryClientProvider client={qc}>
      <HappeningSoonSection soon={soon} now={now} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.parentMode = false;
  state.requiresApproval = true;
  state.facility = null;
});
afterEach(cleanup);

describe("HappeningSoonSection", () => {
  it("renders nothing when no run is open in the next 48 hours", () => {
    const { container } = renderSection([
      game({ id: "far", date: new Date(now + 72 * HOUR).toISOString() }),
    ]);
    expect(container.innerHTML).toBe("");
  });

  it("shows sport and time, location with distance, spots, price and the action", async () => {
    renderSection([game({ id: "a", price: 10 })]);
    expect(screen.getByRole("heading", { name: /Happening Soon/ })).toBeTruthy();
    expect(screen.getByText("Basketball")).toBeTruthy();
    expect(screen.getByText(/^(Today|Tomorrow) at \d{1,2}:\d{2} [AP]M$/)).toBeTruthy();
    expect(screen.getByText("Bogan Park")).toBeTruthy();
    expect(screen.getByText("2.4 mi")).toBeTruthy();
    expect(screen.getByText("2 spots open")).toBeTruthy();
    expect(screen.getByText("$10 direct pay")).toBeTruthy();
    expect(await screen.findByText("Request Spot")).toBeTruthy();
  });

  it("says Join Run when the host does not review requests", async () => {
    state.requiresApproval = false;
    renderSection([game({ id: "a" })]);
    expect(await screen.findByText("Join Run")).toBeTruthy();
    expect(screen.getByText("Free")).toBeTruthy();
  });

  it("falls back to Request Spot when no settings can be read", async () => {
    state.requiresApproval = null;
    renderSection([game({ id: "a" })]);
    await waitFor(() => expect(screen.getByText("Request Spot")).toBeTruthy());
  });

  it("offers a view-only action in Parent Mode", () => {
    state.parentMode = true;
    renderSection([game({ id: "a" })]);
    expect(screen.getByText("View run")).toBeTruthy();
    expect(screen.queryByText("Request Spot")).toBeNull();
  });

  it("shows the facility badge instead of plain text for a registered venue", () => {
    state.facility = { id: "o1", name: "Apex Basketball Hub", verified: true, amenities: [] };
    renderSection([game({ id: "a", orgId: "o1" })]);
    expect(screen.getByRole("button", { name: "Apex Basketball Hub" })).toBeTruthy();
    expect(screen.queryByText("Bogan Park")).toBeNull();
  });

  it("badges the urgency by how many runs start today", () => {
    renderSection([game({ id: "a" }), game({ id: "b", title: "Second run" })]);
    // Both start within 3h; "today" depends on the clock, so accept either badge.
    expect(screen.getByText(/^(2 runs today|2 in the next 48h)$/)).toBeTruthy();
  });
});

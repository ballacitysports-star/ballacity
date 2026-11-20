// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fns = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/lib/tryouts.functions", () => ({
  listUpcomingTryouts: fns.list,
  getTryoutRsvpContext: vi.fn(),
  rsvpTryout: vi.fn(),
  cancelTryoutRsvp: vi.fn(),
  listMyTryoutRegistrations: vi.fn(),
  listMyManagedTeams: vi.fn(),
}));
vi.mock("@/lib/team-posts.functions", () => ({ createTeamPost: vi.fn() }));
vi.mock("@/components/DraftWithAi", () => ({ DraftWithAi: () => null }));

import { TryoutsSection } from "./TryoutsSection";

const tryout = (i: number) => ({
  id: `t${i}`,
  kind: "tryout" as const,
  title: `Tryout ${i}`,
  body: null,
  teamId: `team${i}`,
  teamName: `Team ${i}`,
  eventDate: null,
  location: null,
  venueHidden: false,
  spotsMax: null,
  spotsTaken: 0,
  price: null,
  cancelCutoffMin: 0,
  refundRule: null,
  lateRefundPct: null,
});

function renderSection(compact?: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TryoutsSection compact={compact} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  fns.list.mockReset();
});

describe("TryoutsSection", () => {
  it("is a full section with an h2 by default, listing every event", async () => {
    fns.list.mockResolvedValue([1, 2, 3, 4].map(tryout));
    renderSection();
    expect(screen.getByRole("heading", { level: 2, name: "Open tryouts & camps" })).toBeTruthy();
    expect(await screen.findAllByRole("heading", { level: 3 })).toHaveLength(4);
  });

  it("compact: a sub-block of the landing section, one heading level down, three events", async () => {
    fns.list.mockResolvedValue([1, 2, 3, 4].map(tryout));
    const { container } = renderSection(true);
    expect(
      screen.getByRole("heading", { level: 3, name: "Upcoming tryouts & camps" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    const titles = await screen.findAllByRole("heading", { level: 4 });
    expect(titles.map((t) => t.textContent)).toEqual(["Tryout 1", "Tryout 2", "Tryout 3"]);
    // Keeps the anchor sign-in returns to ("/#tryouts").
    expect(container.querySelector("section#tryouts")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Post a tryout/ })).toBeTruthy();
  });

  it("compact: more than three events shows the count and opens the rest in place", async () => {
    fns.list.mockResolvedValue([1, 2, 3, 4, 5].map(tryout));
    renderSection(true);
    expect(await screen.findAllByRole("heading", { level: 4 })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "See all 5 tryouts & camps" }));
    expect(screen.getAllByRole("heading", { level: 4 }).map((t) => t.textContent)).toEqual([
      "Tryout 1",
      "Tryout 2",
      "Tryout 3",
      "Tryout 4",
      "Tryout 5",
    ]);
    expect(screen.queryByRole("button", { name: /See all/ })).toBeNull();
  });

  it("compact: three or fewer events, no See all", async () => {
    fns.list.mockResolvedValue([1, 2, 3].map(tryout));
    renderSection(true);
    expect(await screen.findAllByRole("heading", { level: 4 })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /See all/ })).toBeNull();
  });

  it("full section never shows See all", async () => {
    fns.list.mockResolvedValue([1, 2, 3, 4, 5].map(tryout));
    renderSection();
    expect(await screen.findAllByRole("heading", { level: 3 })).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /See all/ })).toBeNull();
  });
});

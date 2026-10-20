// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  tables: {} as Record<string, { data: unknown[] | null; error: unknown }>,
  calls: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      h.calls.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: async () => h.tables[table] ?? { data: [], error: null },
      };
      return builder;
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BalancedTeamsPanel } from "./BalancedTeamsPanel";

const PLAYERS = [
  { userId: "a", displayName: "Ace" },
  { userId: "b", displayName: "Bree" },
  { userId: "c", displayName: "Cal" },
  { userId: "d", displayName: "Dee" },
];

afterEach(() => {
  cleanup();
  h.tables = {};
  h.calls = [];
});

function renderPanel(players = PLAYERS) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BalancedTeamsPanel sport="Basketball" players={players} />
    </QueryClientProvider>,
  );
}

const teamNames = (n: number) =>
  within(screen.getByTestId(`team-${n}`))
    .getAllByRole("listitem")
    .map((li) => li.textContent);

describe("BalancedTeamsPanel", () => {
  it("loads nothing until the host opens it", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /Suggest balanced teams/ })).toBeTruthy();
    expect(h.calls).toHaveLength(0);
  });

  it("splits the two strongest players and never shows a rating", async () => {
    h.tables.skill_ratings = {
      data: [
        { user_id: "a", mu: 88 },
        { user_id: "b", mu: 85 },
      ],
      error: null,
    };
    h.tables.profiles = {
      data: [
        { id: "c", sport_levels: { Basketball: { system: "Level", tier: "Casual / Pickup" } } },
        { id: "d", sport_levels: {} },
      ],
      error: null,
    };
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Suggest balanced teams/ }));

    await waitFor(() => expect(screen.getByTestId("team-1")).toBeTruthy());
    const t1 = teamNames(1);
    const t2 = teamNames(2);
    expect([...t1, ...t2].sort()).toEqual(["Ace", "Bree", "Cal", "Dee"]);
    // Ace and Bree are the two strongest: they must be on different teams.
    expect(t1.includes("Ace") !== t1.includes("Bree")).toBe(true);

    expect(screen.getByText(/2 of 4 have a skill rating; 1 use the level they chose/)).toBeTruthy();
    expect(screen.getByText(/Only teams are shown/)).toBeTruthy();
    expect(screen.queryByText(/88|85/)).toBeNull();
  });

  it("still suggests teams when nothing is known about anyone", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Suggest balanced teams/ }));
    await waitFor(() => expect(screen.getByTestId("team-2")).toBeTruthy());
    expect(screen.getByText(/teams are a fair shuffle/)).toBeTruthy();
    expect(screen.getByText("Even match")).toBeTruthy();
  });

  it("offers more teams only when there are enough players", async () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ userId: `u${i}`, displayName: `P${i}` }));
    renderPanel(eight);
    fireEvent.click(screen.getByRole("button", { name: /Suggest balanced teams/ }));
    const group = await screen.findByRole("group", { name: "Number of teams" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["2 teams", "3 teams", "4 teams"]);
    fireEvent.click(within(group).getByRole("button", { name: "4 teams" }));
    await waitFor(() => expect(screen.getByTestId("team-4")).toBeTruthy());
    for (const n of [1, 2, 3, 4]) expect(teamNames(n)).toHaveLength(2);
  });

  it("copies the teams as plain text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Suggest balanced teams/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Copy teams/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toMatch(/^Team 1: .+\nTeam 2: .+$/);
  });
});

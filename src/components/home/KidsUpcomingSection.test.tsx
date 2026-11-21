// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  parentMode: true,
  calls: 0,
  kids: [] as unknown[],
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: unknown;
    children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={String(to)} data-params={JSON.stringify(params ?? null)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/hooks/use-parent-mode", () => ({
  useParentMode: () => ({ isParentMode: h.parentMode, loading: false }),
}));
vi.mock("@/lib/guardian-activity.functions", () => ({
  listChildrenActivity: async () => {
    h.calls += 1;
    return h.kids;
  },
}));

import { KidsUpcomingSection } from "./KidsUpcomingSection";

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const tomorrow = () => new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();

function kid(
  name: string,
  upcoming: { gameId: string; title: string; date: string; status: string }[],
) {
  return {
    childUserId: `id-${name}`,
    name,
    avatarUrl: null,
    teams: [],
    upcoming: upcoming.map((g) => ({
      sport: "Basketball",
      location: null,
      cancelCutoffMin: 0,
      ...g,
    })),
    recent: [],
    invites: [],
    waivers: [],
    updates: [],
    tryouts: [],
  };
}

function renderWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <KidsUpcomingSection />
    </QueryClientProvider>,
  );
  return { client, view };
}

afterEach(() => {
  cleanup();
  h.parentMode = true;
  h.calls = 0;
  h.kids = [];
});

describe("KidsUpcomingSection", () => {
  it("renders nothing and fetches nothing outside parent mode", async () => {
    h.parentMode = false;
    h.kids = [
      kid("Maya", [{ gameId: "g1", title: "Sunday run", date: inAnHour(), status: "joined" }]),
    ];
    const { view } = renderWithClient();
    await new Promise((r) => setTimeout(r, 10));
    expect(view.container.innerHTML).toBe("");
    expect(h.calls).toBe(0);
  });

  it("renders nothing when no game is coming up", async () => {
    h.kids = [kid("Maya", [])];
    const { view } = renderWithClient();
    await waitFor(() => expect(h.calls).toBe(1));
    expect(view.container.innerHTML).toBe("");
  });

  it("lists the children's next games, each linking to its game, from the Parent Center's cache", async () => {
    h.kids = [
      kid("Maya", [
        { gameId: "g2", title: "Tuesday clinic", date: tomorrow(), status: "requested" },
      ]),
      kid("Leo", [{ gameId: "g1", title: "Sunday run", date: inAnHour(), status: "joined" }]),
    ];
    const { client } = renderWithClient();
    await screen.findByText("Sunday run");
    const games = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === "/games/$gameId");
    expect(games.map((a) => a.getAttribute("data-params"))).toEqual([
      '{"gameId":"g1"}',
      '{"gameId":"g2"}',
    ]);
    expect(screen.getByText("Going")).toBeTruthy();
    expect(screen.getByText("Requested")).toBeTruthy();
    expect(screen.getByText(/^Leo · /)).toBeTruthy(); // two children: each row names the child
    expect(
      screen.getByRole("link", { name: "Everything in the Parent Center" }).getAttribute("href"),
    ).toBe("/parent");
    expect(client.getQueryData(["guardian-activity"])).toEqual(h.kids);
  });
});

describe("Home", () => {
  it("shows the children's next games under the parent's approvals", async () => {
    const { readFileSync } = await import("node:fs");
    const feed = readFileSync("src/routes/_tabs.feed.tsx", "utf8");
    const strip = feed.indexOf("<NeedsActionStrip />");
    const kids = feed.indexOf("<KidsUpcomingSection");
    expect(strip).toBeGreaterThan(0);
    expect(kids).toBeGreaterThan(strip);
  });
});

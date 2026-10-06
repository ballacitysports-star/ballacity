// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({ orgs: [] as unknown[] }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    to,
    search,
  }: {
    children: ReactNode;
    className?: string;
    to?: string;
    search?: Record<string, string>;
  }) => (
    <a className={className} data-to={to} data-search={search ? JSON.stringify(search) : undefined}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/ResponsiveImage", () => ({
  ResponsiveImage: ({ alt }: { alt?: string }) => <img alt={alt} />,
}));
vi.mock("@/lib/trainer-orgs.functions", () => ({
  listTrainerOrgs: () => Promise.resolve(state.orgs),
}));

import type { Game } from "@/lib/sample-data";
import { NearbyFacilitiesSection } from "./NearbyFacilitiesSection";

const HOUR = 3_600_000;
const open24 = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), { open24: true }]));
const closedAlways = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), { closed: true }]),
);

const org = (over: Record<string, unknown> = {}) => ({
  id: "o1",
  name: "Apex Basketball Hub",
  handle: "apex",
  avatar: null,
  avatar_url: null,
  cover_url: "https://img.test/cover.jpg",
  photos: [],
  city: "Buford",
  address: "1 Court St",
  bio: null,
  category: "Basketball gym",
  amenities: ["3 courts", "Indoor courts", "Parking", "Lockers"],
  hours: open24,
  timezone: "UTC",
  website: null,
  verified: true,
  geo: { lat: 33.8, lng: -84.4 },
  ...over,
});

const run = (id: string, orgId: string, hoursAhead: number): Game =>
  ({
    id,
    orgId,
    sport: "Basketball",
    title: "Run",
    date: new Date(Date.now() + hoursAhead * HOUR).toISOString(),
    duration: "90 min",
    isPrivate: false,
  }) as Game;

function renderSection(games: Game[], viewer: { lat: number; lng: number } | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NearbyFacilitiesSection games={games} viewer={viewer} unit="mi" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.orgs = [org()];
});
afterEach(cleanup);

describe("NearbyFacilitiesSection", () => {
  it("shows the open badge, name, amenities and this week's activity", async () => {
    renderSection([
      run("g1", "o1", 5),
      run("g2", "o1", 30),
      run("g3", "o1", 60),
      run("g4", "o1", 90),
    ]);
    expect(await screen.findByText("Apex Basketball Hub")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Nearby Courts & Facilities/ })).toBeTruthy();
    expect(screen.getByText("Open now")).toBeTruthy();
    expect(screen.getByText("· Open 24 hours")).toBeTruthy();
    expect(screen.getByLabelText("Verified")).toBeTruthy();
    for (const tag of ["3 courts", "Parking", "Lockers"]) {
      expect(screen.getByText(new RegExp(tag, "i"))).toBeTruthy();
    }
    expect(screen.getByText("4 pickup runs hosted here this week")).toBeTruthy();
    const cta = screen.getByText("View Courts & Runs");
    expect(cta.getAttribute("data-to")).toBe("/orgs/$orgId");
  });

  it("shows the distance once the viewer has a location", async () => {
    renderSection([], { lat: 33.7, lng: -84.4 });
    expect(await screen.findByText(/^\d+\.\d mi away$/)).toBeTruthy();
  });

  it("falls back to the city when distance is unknown", async () => {
    renderSection([]);
    expect(await screen.findByText("Buford")).toBeTruthy();
    expect(screen.queryByText(/away$/)).toBeNull();
  });

  it("turns the action into Host a run here, pre-filled for that facility, when nothing is scheduled", async () => {
    renderSection([run("old", "o1", 24 * 9)]);
    const cta = await screen.findByText("Host a run here");
    expect(cta.getAttribute("data-to")).toBe("/create");
    expect(JSON.parse(cta.getAttribute("data-search") ?? "{}")).toEqual({
      orgId: "o1",
      kind: "run",
    });
    expect(screen.getByText(/No runs posted this week/)).toBeTruthy();
  });

  it("reports a closed gym as closed", async () => {
    state.orgs = [org({ hours: closedAlways })];
    renderSection([]);
    expect(await screen.findByText("Closed")).toBeTruthy();
  });

  it("links to the full directory", async () => {
    renderSection([]);
    const link = await screen.findByText("Explore all gyms");
    expect(link.getAttribute("data-to")).toBe("/orgs");
  });

  it("renders nothing when no facility is listed", async () => {
    state.orgs = [];
    const { container } = renderSection([]);
    await vi.waitFor(() => expect(container.querySelector("section")).toBeNull());
  });
});

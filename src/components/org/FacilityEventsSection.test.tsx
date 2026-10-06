// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Game } from "@/lib/sample-data";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    "aria-label"?: string;
  }) => {
    let href = to;
    for (const [k, v] of Object.entries(params ?? {})) href = href.replace(`$${k}`, v);
    if (search) href += `?${new URLSearchParams(search).toString()}`;
    return (
      <a href={href} aria-label={rest["aria-label"]}>
        {children}
      </a>
    );
  },
}));
vi.mock("@/components/UserAvatar", () => ({
  UserAvatarById: ({ name }: { name?: string }) => <span data-testid="host-avatar">{name}</span>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/games-store", () => ({ useIsJoined: () => false }));
vi.mock("@/lib/game-participants-store", () => ({ useLiveParticipantCount: () => undefined }));
vi.mock("@/lib/live-status", () => ({
  useJoinGate: () => ({ locked: false, waitlistOpen: false, label: "", liveStatus: "upcoming" }),
  computeLiveStatus: () => "upcoming",
}));

const hideGameFromOrg = vi.fn().mockResolvedValue(undefined);
const games: Game[] = [];
vi.mock("@/lib/hosted-games-store", () => ({
  fetchHostedGamesForOrg: () => Promise.resolve(games),
  hideGameFromOrg: (...args: unknown[]) => hideGameFromOrg(...args),
}));

const { FacilityEventsSection } = await import("./FacilityEventsSection");

const future = new Date(Date.now() + 86_400_000).toISOString();
function game(id: string, title: string, orgOfficial: boolean, sport = "Basketball"): Game {
  return {
    id,
    hostUserId: `host-${id}`,
    sport,
    title,
    host: { name: "Host", username: "@host", avatar: "H", rating: 5 },
    date: future,
    duration: "2h",
    location: "Gym",
    neighborhood: "",
    distanceMi: null,
    maxPlayers: 10,
    joined: 2,
    skill: "All levels",
    price: 0,
    indoor: true,
    image: "",
    description: "",
    equipment: [],
    orgId: "org-1",
    orgOfficial,
  } as unknown as Game;
}

function renderSection(canPost: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FacilityEventsSection orgId="org-1" canPost={canPost} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  games.length = 0;
  hideGameFromOrg.mockClear();
});

describe("FacilityEventsSection", () => {
  it("lets any visitor host a run and labels official vs community runs", async () => {
    games.push(game("g1", "Apex Open Run", true), game("g2", "Sunday hoops", false));
    renderSection(false);
    expect(screen.getByRole("link", { name: /host a run here/i }).getAttribute("href")).toBe(
      "/create?orgId=org-1&kind=run",
    );
    expect(screen.queryByRole("link", { name: /post official event/i })).toBeNull();
    expect(await screen.findByText("Official")).toBeTruthy();
    expect(screen.getByText("Community run")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /hide/i })).toBeNull();
  });

  it("gives admins an official-event link and a hide action for community runs only", async () => {
    games.push(game("g1", "Apex Open Run", true), game("g2", "Sunday hoops", false));
    renderSection(true);
    expect(screen.getByRole("link", { name: /post official event/i })).toBeTruthy();
    const hide = await screen.findByRole("button", { name: "Hide Sunday hoops from this page" });
    expect(screen.queryByRole("button", { name: "Hide Apex Open Run from this page" })).toBeNull();
    fireEvent.click(hide);
    await vi.waitFor(() => expect(hideGameFromOrg).toHaveBeenCalledWith("g2", true));
  });

  it("filters the schedule by sport and links each host's profile", async () => {
    games.push(
      game("g1", "Hoops night", false, "Basketball"),
      game("g2", "Spike session", false, "Volleyball"),
    );
    renderSection(false);
    expect(await screen.findByText("Hoops night")).toBeTruthy();
    expect(screen.getByText("Spike session")).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: "View Host's profile" })
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/players/host-g1", "/players/host-g2"]);

    const group = screen.getByRole("group", { name: "Filter by sport" });
    fireEvent.click(within(group).getByRole("button", { name: /Volleyball/ }));
    expect(screen.queryByText("Hoops night")).toBeNull();
    expect(screen.getByText("Spike session")).toBeTruthy();
    fireEvent.click(within(group).getByRole("button", { name: /All sports/ }));
    expect(screen.getByText("Hoops night")).toBeTruthy();
  });

  it("hides the sport filter when a facility only hosts one sport", async () => {
    games.push(game("g1", "Hoops night", false), game("g2", "More hoops", false));
    renderSection(false);
    await screen.findByText("Hoops night");
    expect(screen.queryByRole("group", { name: "Filter by sport" })).toBeNull();
  });
});

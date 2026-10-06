// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => {
    let href = to;
    for (const [k, v] of Object.entries(params ?? {})) href = href.replace(`$${k}`, v);
    return <a href={href}>{children}</a>;
  },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/player-passport.functions", () => ({ getPlayerPassport: vi.fn() }));
vi.mock("@/components/venue/VenueBadge", () => ({
  VenueBadge: ({ orgId }: { orgId: string }) => <span data-testid="venue">{orgId}</span>,
}));

const { PlayerPassportView } = await import("./PlayerPassportSection");

afterEach(cleanup);

describe("PlayerPassportView", () => {
  it("renders nothing for an empty passport", () => {
    const { container } = render(
      <PlayerPassportView passport={{ teams: [], accolades: [], upcomingRuns: [] }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("links teams, tryouts and runs back to their pages", () => {
    render(
      <PlayerPassportView
        passport={{
          teams: [
            {
              id: "t1",
              name: "Balacity 14U",
              handle: null,
              avatar: "🏀",
              kind: "team",
              role: "player",
            },
            {
              id: "c1",
              name: "Coach Dre",
              handle: null,
              avatar: null,
              kind: "coach",
              role: "player",
            },
          ],
          accolades: [
            {
              postId: "p1",
              title: "Spring Tryout",
              kind: "tryout",
              teamId: "t1",
              teamName: "Balacity 14U",
              date: null,
            },
          ],
          upcomingRuns: [
            {
              id: "g1",
              title: "Sunday hoops",
              sport: "Basketball",
              date: new Date(Date.now() + 86_400_000).toISOString(),
              location: "Apex Hub",
              orgId: "org-1",
            },
          ],
        }}
      />,
    );
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/teams/t1", "/trainers/c1", "/tryouts/p1", "/games/g1"]);
    expect(screen.getByText(/Attended Spring Tryout · Balacity 14U/)).toBeTruthy();
    expect(screen.getByTestId("venue").textContent).toBe("org-1");
  });
});

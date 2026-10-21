// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    search?: unknown;
    className?: string;
  }) => (
    <a href={to} data-search={JSON.stringify(search ?? null)} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/Logo", () => ({ Logo: () => <span>BallaCity</span> }));
const getPublicTeam = vi.fn();
vi.mock("@/lib/city-pages.functions", () => ({
  getPublicTeam: (args: unknown) => getPublicTeam(args),
}));

import { PublicTeamPreview } from "./PublicTeamPreview";
import type { PublicTeam } from "@/lib/city-seo";

afterEach(() => {
  cleanup();
  getPublicTeam.mockReset();
});

const team = (over: Partial<PublicTeam> = {}): PublicTeam => ({
  id: "t1",
  name: "Harlem Hoopers",
  handle: "@hoopers",
  city: "New York, NY",
  sports: ["Basketball"],
  tagline: "Run-and-gun since 2019",
  bio: "Open runs every Sunday.",
  verified: false,
  founded: 2019,
  openSpots: 0,
  ...over,
});

const NEXT = "/teams/t1";
const renderIt = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PublicTeamPreview teamId="t1" next={NEXT} />
    </QueryClientProvider>,
  );

describe("PublicTeamPreview", () => {
  it("shows a team's public description", async () => {
    getPublicTeam.mockResolvedValue(team());
    renderIt();
    expect(await screen.findByRole("heading", { name: "Harlem Hoopers" })).toBeTruthy();
    expect(screen.getByText("Basketball")).toBeTruthy();
    expect(screen.getByText("Open runs every Sunday.")).toBeTruthy();
    expect(getPublicTeam).toHaveBeenCalledWith({ data: { id: "t1" } });
  });

  it("shows Verified only for a verified team", async () => {
    getPublicTeam.mockResolvedValue(team({ verified: false }));
    const first = renderIt();
    await screen.findByRole("heading", { name: "Harlem Hoopers" });
    expect(screen.queryByText("Verified")).toBeNull();
    first.unmount();
    getPublicTeam.mockResolvedValue(team({ verified: true }));
    renderIt();
    expect(await screen.findByText("Verified")).toBeTruthy();
  });

  it("shows recruiting only when spots are open, with the real count", async () => {
    getPublicTeam.mockResolvedValue(team({ openSpots: 3 }));
    renderIt();
    expect(await screen.findByText(/Recruiting/)).toBeTruthy();
    expect(screen.getByText(/3 spots open/)).toBeTruthy();
  });

  it("does not claim recruiting when no spots are posted", async () => {
    getPublicTeam.mockResolvedValue(team({ openSpots: 0 }));
    renderIt();
    await screen.findByRole("heading", { name: "Harlem Hoopers" });
    expect(screen.queryByText(/Recruiting/)).toBeNull();
  });

  it("sends sign-up back to the same team", async () => {
    getPublicTeam.mockResolvedValue(team());
    renderIt();
    const signup = await screen.findByRole("link", { name: "Create a free account to follow" });
    expect(JSON.parse(signup.getAttribute("data-search")!)).toEqual({ next: NEXT, mode: "signup" });
  });

  it("shows one generic prompt when the team is not public or not found", async () => {
    getPublicTeam.mockResolvedValue(null);
    renderIt();
    expect(
      await screen.findByRole("heading", { name: "This team is for BallaCity members" }),
    ).toBeTruthy();
    expect(screen.queryByText("Harlem Hoopers")).toBeNull();
    expect(screen.getByRole("link", { name: "Create a free account" })).toBeTruthy();
  });

  it("falls back to the same prompt when the read fails", async () => {
    getPublicTeam.mockRejectedValue(new Error("boom"));
    renderIt();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "This team is for BallaCity members" }),
      ).toBeTruthy(),
    );
  });
});

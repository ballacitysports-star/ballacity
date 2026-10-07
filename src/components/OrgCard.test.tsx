// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Org } from "@/lib/sample-data";

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
  useNavigate: () => nav.navigate,
}));
vi.mock("framer-motion", () => ({
  motion: { div: ({ children }: { children: ReactNode }) => <div>{children}</div> },
}));
vi.mock("@/components/ResponsiveImage", () => ({
  ResponsiveImage: () => <img alt="" />,
  ResponsiveAvatar: () => <img alt="" />,
}));

import { OrgCard } from "./OrgCard";

afterEach(() => {
  cleanup();
  nav.navigate.mockReset();
});

const coach = (over: Partial<Org> = {}): Org =>
  ({
    id: "t1",
    kind: "coach",
    name: "Coach Dre",
    handle: "@dre",
    tagline: "Guard skills",
    city: "Austin",
    sports: ["Basketball"],
    verified: true,
    cover: "https://img.test/c.jpg",
    avatar: "CD",
    accent: "#a3ff12",
    followers: 10,
    roster: 0,
    bio: "",
    achievements: [],
    ...over,
  }) as Org;

describe("OrgCard for trainers", () => {
  it("shows the hourly rate, real rating and review count", () => {
    render(<OrgCard org={coach({ ratePerHour: 85, rating: 4.7, reviews: 12 })} />);
    expect(screen.getByText("$85/hr")).toBeTruthy();
    expect(screen.getByText(/4\.7 · 12/)).toBeTruthy();
  });

  it("shows the facility they train at and opens it without opening the trainer", () => {
    render(<OrgCard org={coach()} facility={{ id: "o9", name: "Apex Basketball Hub" }} />);
    expect(screen.getByText("Trains at")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Apex Basketball Hub/ }));
    expect(nav.navigate).toHaveBeenCalledWith({ to: "/orgs/$orgId", params: { orgId: "o9" } });
  });

  it("shows no rate, rating or facility row when there's nothing to show", () => {
    render(<OrgCard org={coach()} />);
    expect(screen.queryByText(/\/hr/)).toBeNull();
    expect(screen.queryByText("Trains at")).toBeNull();
  });

  it("doesn't show trainer-only details on a team card", () => {
    render(
      <OrgCard
        org={coach({ kind: "team", ratePerHour: 85 })}
        facility={{ id: "o9", name: "Apex Basketball Hub" }}
      />,
    );
    expect(screen.queryByText("$85/hr")).toBeNull();
    expect(screen.queryByText("Trains at")).toBeNull();
  });
});

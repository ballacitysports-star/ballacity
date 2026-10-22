// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/UserAvatar", () => ({ UserAvatar: () => <span /> }));

const state = vi.hoisted(() => ({
  roster: { all: [] as unknown[], needsAction: [] as unknown[], isLoading: false },
  pending: { invites: 0, requests: 0, waitingChildren: 0, total: 0 },
}));
vi.mock("@/lib/family-roster", () => ({ useFamilyRoster: () => state.roster }));
vi.mock("@/lib/use-family-pending", () => ({
  useFamilyPending: () => ({ pending: state.pending, isLoading: false }),
}));

import { FamilyCard } from "./FamilyCard";

const entry = (name: string, needsGuardian: boolean, statusLabel: string) => ({
  child: { childUserId: name, displayName: name, avatarUrl: null },
  needsGuardian,
  statusLabel,
});

afterEach(() => {
  cleanup();
  state.roster = { all: [], needsAction: [], isLoading: false };
  state.pending = { invites: 0, requests: 0, waitingChildren: 0, total: 0 };
});

describe("FamilyCard", () => {
  it("lists each child with where they stand, and links into the Parent Center", () => {
    state.roster.all = [
      entry("Nathaniel", false, "Approved"),
      entry("Ava", true, "Waiting on your approval"),
    ];
    render(<FamilyCard />);
    expect(screen.getByText("Nathaniel")).toBeTruthy();
    expect(screen.getByText("Ava")).toBeTruthy();
    expect(screen.getByText("Waiting on your approval")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Parent Center" }).getAttribute("href")).toBe(
      "/parent",
    );
  });

  it("says how much is waiting on the parent", () => {
    state.roster.all = [entry("Ava", true, "Waiting on your approval")];
    state.pending = { invites: 1, requests: 2, waitingChildren: 1, total: 4 };
    render(<FamilyCard />);
    expect(screen.getByText("4 waiting on you")).toBeTruthy();
    expect(
      screen.getByText("1 child needs your approval · 2 game requests · 1 team invite"),
    ).toBeTruthy();
  });

  it("shows no 'waiting' pill when nothing is", () => {
    state.roster.all = [entry("Nathaniel", false, "Approved")];
    render(<FamilyCard />);
    expect(screen.queryByText(/waiting on you/)).toBeNull();
  });

  it("invites a parent with no children yet to add one", () => {
    render(<FamilyCard />);
    expect(screen.getByText(/No children linked yet/)).toBeTruthy();
  });
});

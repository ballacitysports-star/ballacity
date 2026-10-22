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

const state = vi.hoisted(() => ({
  parent: true,
  pending: { invites: 0, requests: 0, waitingChildren: 0, total: 0 },
}));
vi.mock("@/hooks/use-parent-mode", () => ({
  useParentMode: () => ({ isParentMode: state.parent, loading: false }),
}));
vi.mock("@/lib/use-family-pending", () => ({
  useFamilyPending: () => ({ pending: state.pending, isLoading: false }),
}));

import { FamilyInboxSection } from "./FamilyInboxSection";

afterEach(() => {
  cleanup();
  state.parent = true;
  state.pending = { invites: 0, requests: 0, waitingChildren: 0, total: 0 };
});

describe("FamilyInboxSection", () => {
  it("shows what is waiting and links to the Parent Center", () => {
    state.pending = { invites: 1, requests: 2, waitingChildren: 0, total: 3 };
    render(<FamilyInboxSection />);
    expect(screen.getByText("Waiting on you")).toBeTruthy();
    expect(screen.getByText("2 game requests · 1 team invite")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/parent");
  });

  it("renders nothing when nothing waits", () => {
    const { container } = render(<FamilyInboxSection />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a non-parent account", () => {
    state.parent = false;
    state.pending = { invites: 1, requests: 0, waitingChildren: 0, total: 1 };
    const { container } = render(<FamilyInboxSection />);
    expect(container.innerHTML).toBe("");
  });
});

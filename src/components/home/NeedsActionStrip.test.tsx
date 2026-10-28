// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  items: [] as unknown[],
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, params, children, ...rest }: any) => (
    <a href={String(to)} data-params={JSON.stringify(params ?? null)} {...rest}>
      {children as ReactNode}
    </a>
  ),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/components/child/FamilyInboxSection", () => ({
  FamilyInboxSection: () => <div data-testid="family" />,
}));
vi.mock("@/lib/use-needs-action", () => ({
  useNeedsAction: () => ({ items: h.items, isLoading: false }),
}));

import { NeedsActionStrip } from "./NeedsActionStrip";

afterEach(() => {
  cleanup();
  h.user = { id: "u1" };
  h.items = [];
});

describe("NeedsActionStrip", () => {
  it("renders nothing for a signed-out visitor", () => {
    h.user = null;
    const { container } = render(<NeedsActionStrip />);
    expect(container.innerHTML).toBe("");
  });

  it("shows no heading or rows when nothing is waiting", () => {
    render(<NeedsActionStrip />);
    expect(screen.queryByText("Needs you now")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("lists what is waiting, each row a link to where it is answered", () => {
    h.items = [
      {
        id: "host-requests",
        label: "2 join requests to answer",
        detail: "Friday run",
        to: "/games/$gameId",
        params: { gameId: "g1" },
        tone: "urgent",
      },
      { id: "messages", label: "3 unread messages", detail: null, to: "/messages", tone: "info" },
    ];
    render(<NeedsActionStrip />);
    expect(screen.getByText("Needs you now")).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute("href")).toBe("/games/$gameId");
    expect(links[0]!.getAttribute("data-params")).toBe('{"gameId":"g1"}');
    expect(screen.getByText("Friday run")).toBeTruthy();
    expect(links[1]!.getAttribute("href")).toBe("/messages");
  });
});

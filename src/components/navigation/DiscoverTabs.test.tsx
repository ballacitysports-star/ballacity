// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const loc = vi.hoisted(() => ({ pathname: "/teams" }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className} {...rest}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: loc.pathname }),
}));

import { DiscoverTabs } from "./DiscoverTabs";
import { showsDiscoverTabs } from "@/lib/discover-paths";

afterEach(cleanup);

describe("DiscoverTabs", () => {
  it("links the four discovery pages and marks the current one", () => {
    loc.pathname = "/teams";
    render(<DiscoverTabs />);
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/players",
      "/teams",
      "/trainers",
      "/orgs",
    ]);
    expect(screen.getByRole("link", { name: "Teams" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Players" }).getAttribute("aria-current")).toBeNull();
  });

  it("shows only above the three tab pages, not detail pages", () => {
    for (const p of ["/players", "/teams/", "/trainers"]) expect(showsDiscoverTabs(p)).toBe(true);
    for (const p of ["/teams/abc", "/teams/create", "/players/x", "/feed", "/orgs"]) {
      expect(showsDiscoverTabs(p)).toBe(false);
    }
  });

  it("renders nothing elsewhere", () => {
    loc.pathname = "/feed";
    const { container } = render(<DiscoverTabs />);
    expect(container.firstChild).toBeNull();
  });
});

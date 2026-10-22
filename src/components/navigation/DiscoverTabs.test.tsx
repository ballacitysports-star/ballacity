// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const loc = vi.hoisted(() => ({ pathname: "/teams", search: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    className,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    search?: Record<string, unknown>;
    className?: string;
  }) => (
    <a href={to} data-search={JSON.stringify(search ?? {})} className={className} {...rest}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: loc.pathname, search: loc.search }),
}));

import { DiscoverTabs, carriedQuery } from "./DiscoverTabs";
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

  it("carries the search text to every section", () => {
    loc.pathname = "/players";
    loc.search = { q: "  dana " };
    render(<DiscoverTabs />);
    for (const a of screen.getAllByRole("link")) {
      expect(JSON.parse(a.getAttribute("data-search")!)).toEqual({ q: "dana" });
    }
    loc.search = {};
  });

  it("carries nothing when the search is empty or not text", () => {
    expect(carriedQuery({})).toBe("");
    expect(carriedQuery({ q: "" })).toBe("");
    expect(carriedQuery({ q: 5 })).toBe("");
    expect(carriedQuery(undefined)).toBe("");
  });

  it("shows only above the three tab pages, not detail pages", () => {
    for (const p of ["/players", "/teams/", "/trainers", "/orgs"])
      expect(showsDiscoverTabs(p)).toBe(true);
    for (const p of ["/teams/abc", "/teams/create", "/players/x", "/feed", "/orgs/abc"]) {
      expect(showsDiscoverTabs(p)).toBe(false);
    }
  });

  it("renders nothing elsewhere", () => {
    loc.pathname = "/feed";
    const { container } = render(<DiscoverTabs />);
    expect(container.firstChild).toBeNull();
  });
});

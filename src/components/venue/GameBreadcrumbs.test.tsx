// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ org: null as null | { id: string; name: string } }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    "aria-label"?: string;
  }) => {
    let href = to;
    for (const [k, v] of Object.entries(params ?? {})) href = href.replace(`$${k}`, v);
    return (
      <a href={href} aria-label={rest["aria-label"]}>
        {children}
      </a>
    );
  },
}));
vi.mock("@/components/venue/VenueBadge", () => ({
  useFacilityName: () => ({ data: h.org }),
}));

import { GameBreadcrumbs } from "./GameBreadcrumbs";

afterEach(() => {
  cleanup();
  h.org = null;
});

describe("GameBreadcrumbs", () => {
  it("renders Gyms > facility > game with the game as the current page", () => {
    h.org = { id: "o1", name: "Apex Basketball Hub" };
    render(<GameBreadcrumbs orgId="o1" gameTitle="Sunday run" />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav.textContent).toContain("Gyms");
    expect(screen.getByRole("link", { name: "Gyms" }).getAttribute("href")).toBe("/orgs");
    expect(
      screen
        .getByRole("link", { name: "View Apex Basketball Hub profile and weekly schedule" })
        .getAttribute("href"),
    ).toBe("/orgs/o1");
    expect(screen.getByText("Sunday run").getAttribute("aria-current")).toBe("page");
  });

  it("renders nothing without a facility", () => {
    const { container } = render(<GameBreadcrumbs orgId={undefined} gameTitle="Pickup" />);
    expect(container.innerHTML).toBe("");
  });
});

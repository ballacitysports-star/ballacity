// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

import { PublicGamesEmpty } from "./PublicGamesEmpty";

afterEach(cleanup);

const props = () => ({
  cityName: "Atlanta",
  next: "/cities?city=atlanta&sport=Soccer",
  onShowAllSports: vi.fn(),
  onPickCity: vi.fn(),
});

describe("PublicGamesEmpty", () => {
  it("says only that nothing is listed, and promises no games or alerts", () => {
    const { container } = render(<PublicGamesEmpty {...props()} />);
    const text = container.textContent ?? "";
    expect(text).toContain("No public games listed yet.");
    expect(text).toContain("Nothing is listed in Atlanta right now");
    expect(text).not.toMatch(/notif|alert|coming soon|we'?ll let you know/i);
  });

  it("offers more than hosting: another city, an account, and hosting", () => {
    render(<PublicGamesEmpty {...props()} />);
    expect(screen.getByRole("button", { name: "Try another city" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create a free account" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Host a game/ })).toBeTruthy();
  });

  it("keeps the visitor's place when they create an account", () => {
    render(<PublicGamesEmpty {...props()} />);
    const link = screen.getByRole("link", { name: "Create a free account" });
    expect(link.getAttribute("href")).toBe("/auth");
    expect(JSON.parse(link.getAttribute("data-search")!)).toEqual({
      mode: "signup",
      next: "/cities?city=atlanta&sport=Soccer",
    });
  });

  it("with a sport filter, offers all sports first and still the other ways out", () => {
    const p = props();
    render(<PublicGamesEmpty {...p} sport="Soccer" />);
    expect(screen.getByText("No public soccer games listed yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all sports" }));
    expect(p.onShowAllSports).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Try another city" }));
    expect(p.onPickCity).toHaveBeenCalledTimes(1);
  });

  it("has no participation action: nothing here joins, requests or messages", () => {
    const { container } = render(<PublicGamesEmpty {...props()} />);
    expect(container.textContent).not.toMatch(/\bjoin\b|request a spot|message/i);
  });
});

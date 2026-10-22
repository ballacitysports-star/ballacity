// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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

import { PublicGamePreview } from "./PublicGamePreview";
import type { PublicGameSeo } from "@/lib/city-pages.functions";

afterEach(cleanup);

const seo = (over: Partial<PublicGameSeo> = {}): PublicGameSeo => ({
  id: "g1",
  title: "Sunday Morning Run",
  sport: "Basketball",
  date: "2099-06-14T15:00:00.000Z",
  location: "Rucker Park",
  neighborhood: "Harlem",
  price: 0,
  description: "Full court, bring a dark and a light shirt.",
  allDay: false,
  indexable: true,
  ...over,
});

const NEXT = "/games/g1?invite=1&from=u2";

describe("PublicGamePreview", () => {
  it("shows the public facts of an open game", () => {
    render(<PublicGamePreview seo={seo()} next={NEXT} />);
    expect(screen.getByRole("heading", { name: "Sunday Morning Run" })).toBeTruthy();
    expect(screen.getByText("Rucker Park · Harlem")).toBeTruthy();
    expect(screen.getByText("Free to play")).toBeTruthy();
    expect(screen.getByText(/dark and a light shirt/)).toBeTruthy();
  });

  it("shows a fee when there is one", () => {
    render(<PublicGamePreview seo={seo({ price: 12 })} next={NEXT} />);
    expect(screen.getByText("$12.00 to play")).toBeTruthy();
  });

  it("never shows a clock time for an all-day game", () => {
    render(<PublicGamePreview seo={seo({ allDay: true })} next={NEXT} />);
    expect(screen.getByText(/All day/)).toBeTruthy();
  });

  it("sends sign-up and sign-in back to the same game, keeping an invite", () => {
    render(<PublicGamePreview seo={seo()} next={NEXT} />);
    const signup = screen.getByRole("link", { name: "Create a free account to join" });
    expect(JSON.parse(signup.getAttribute("data-search")!)).toEqual({ next: NEXT, mode: "signup" });
    const signIns = screen.getAllByRole("link", { name: "Sign in" });
    expect(signIns.length).toBe(2);
    for (const a of signIns)
      expect(JSON.parse(a.getAttribute("data-search")!)).toEqual({ next: NEXT });
  });

  it("reveals nothing about a game that is not public", () => {
    const hidden = seo({ indexable: false, title: "Pickup game", location: "", neighborhood: "" });
    // Even if the data carried details, a non-public game must not render them.
    render(
      <PublicGamePreview
        seo={{
          ...hidden,
          title: "Under-16 Practice",
          location: "Elm Street Gym",
          description: "Kids",
        }}
        next={NEXT}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "This game is for BallaCity members" }),
    ).toBeTruthy();
    expect(screen.queryByText(/Under-16 Practice/)).toBeNull();
    expect(screen.queryByText(/Elm Street Gym/)).toBeNull();
    expect(screen.queryByText("Kids")).toBeNull();
    expect(screen.getByRole("link", { name: "Create a free account" })).toBeTruthy();
  });

  it("falls back to the same prompt when the game could not be read", () => {
    render(<PublicGamePreview seo={null} next={NEXT} />);
    expect(
      screen.getByRole("heading", { name: "This game is for BallaCity members" }),
    ).toBeTruthy();
  });
});

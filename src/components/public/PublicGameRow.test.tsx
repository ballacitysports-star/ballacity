// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    className,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    className?: string;
  }) => (
    <a
      href={to.replace("$gameId", params?.gameId ?? "")}
      data-to={to}
      data-params={JSON.stringify(params ?? null)}
      className={className}
    >
      {children}
    </a>
  ),
}));

import { PublicGameRow } from "./PublicGameRow";
import type { CityGameRow } from "@/lib/city-seo";

afterEach(cleanup);

const row = (over: Partial<CityGameRow> = {}): CityGameRow => ({
  id: "g1",
  title: "Sunday Morning Run",
  sport: "Basketball",
  date: "2099-06-14T15:00:00.000Z",
  location: "Rucker Park",
  neighborhood: "Harlem",
  price: 0,
  skill: "Intermediate",
  lat: 40.8301234,
  lng: -73.9367654,
  min_age: 18,
  max_age: null,
  is_private: false,
  hidden_at: null,
  org_hidden_at: null,
  cancelled_at: null,
  ...over,
});

describe("PublicGameRow", () => {
  it("shows only the public summary: sport, title, time, area, skill and price", () => {
    const { container } = render(<PublicGameRow g={row()} />);
    for (const text of ["Sunday Morning Run", "Basketball", "Intermediate", "Free"]) {
      expect(container.textContent).toContain(text);
    }
    expect(container.textContent).toContain("Rucker Park · Harlem");
  });

  it("renders no coordinates, ages or host details, even though the row carries some", () => {
    const { container } = render(<PublicGameRow g={row()} />);
    const html = container.innerHTML;
    for (const leak of ["40.83", "73.93", "lat", "lng", "min_age", "host"]) {
      expect(html.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it("links to the public game page, which shows a sign-in preview to visitors", () => {
    render(<PublicGameRow g={row()} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("data-to")).toBe("/games/$gameId");
    expect(link.getAttribute("href")).toBe("/games/g1");
  });

  it("shows a price when there is one", () => {
    const { container } = render(<PublicGameRow g={row({ price: 10 })} />);
    expect(container.textContent).toContain("$10");
    expect(container.textContent).not.toContain("Free");
  });

  it("has no join, message or host control: it is a read-only link", () => {
    render(<PublicGameRow g={row()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

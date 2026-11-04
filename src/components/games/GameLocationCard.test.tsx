// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ExactLocationStatus } from "@/lib/youth-game-location";

const h = vi.hoisted(() => ({ status: "ready" as ExactLocationStatus, retry: vi.fn() }));
vi.mock("@/hooks/use-exact-location", () => ({
  useExactLocationStatus: () => h.status,
  retryExactLocations: h.retry,
}));

import { GameLocationCard } from "./GameLocationCard";

const exactGame = {
  location: "Lincoln Park Court 3, 12 Main St",
  neighborhood: "Decatur",
  indoor: false,
  minAge: 13,
  maxAge: 17,
  locationPrecision: "exact" as const,
};
const coarseGame = { ...exactGame, location: "Decatur", locationPrecision: "approximate" as const };

afterEach(cleanup);

describe("GameLocationCard", () => {
  it("shows the venue and directions to someone the database released it to", () => {
    h.status = "ready";
    render(<GameLocationCard game={exactGame} signedIn />);
    expect(screen.getByText("Lincoln Park Court 3, 12 Main St")).toBeTruthy();
    expect(screen.getByText("Directions")).toBeTruthy();
  });

  it("shows the area and a note, and no directions, to everyone else", () => {
    h.status = "ready";
    render(<GameLocationCard game={coarseGame} signedIn />);
    expect(screen.queryByText("Directions")).toBeNull();
    expect(screen.getByRole("note").textContent).toContain("once you're confirmed");
    expect(document.body.textContent).not.toContain("Lincoln Park");
  });

  it("says so while access is being checked (mobile-friendly loading state)", () => {
    h.status = "loading";
    render(<GameLocationCard game={coarseGame} signedIn />);
    expect(screen.getByRole("status").textContent).toContain("Checking your access");
    expect(screen.queryByText("Directions")).toBeNull();
  });

  it("offers Try again when access could not be checked", () => {
    h.status = "error";
    h.retry.mockClear();
    render(<GameLocationCard game={coarseGame} signedIn />);
    expect(screen.getByRole("alert").textContent).toContain("couldn't check");
    fireEvent.click(screen.getByText("Try again"));
    expect(h.retry).toHaveBeenCalled();
  });

  it("asks a signed-out visitor to sign in", () => {
    h.status = "ready";
    render(<GameLocationCard game={coarseGame} signedIn={false} />);
    expect(screen.getByRole("note").textContent).toContain("Sign in");
  });

  it("never degrades an adult-only game", () => {
    h.status = "loading";
    render(<GameLocationCard game={{ ...exactGame, minAge: 18, maxAge: null }} signedIn />);
    expect(screen.getByText("Directions")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const distance = vi.hoisted(() => ({ mi: null as number | null }));

vi.mock("@/lib/game-distance", () => ({
  useGameDistance: () => ({
    mi: distance.mi,
    reason: distance.mi == null ? "no-viewer-location" : null,
    status: "prompt",
    remembered: false,
    explanation: null,
    error: null,
    requestLocation: vi.fn(),
  }),
}));
vi.mock("@/components/Distance", () => ({ Distance: ({ mi }: { mi: number }) => <>{mi} mi</> }));
vi.mock("@/components/LocationAccessDialog", () => ({ LocationAccessDialog: () => null }));

import { GamePlaceDistance } from "./GameDistance";

afterEach(() => {
  cleanup();
  distance.mi = null;
});

const game = {
  lat: 34.1,
  lng: -84.0,
  pseudoGeo: false,
  distanceMi: null,
  location: "Coolray Field, 2500 Buford Dr, Lawrenceville, GA 30043, USA",
  neighborhood: "",
} as never;

describe("GamePlaceDistance", () => {
  it("shows the venue instead of an Enable location prompt", () => {
    render(<GamePlaceDistance game={game} />);
    expect(screen.getByText("Coolray Field")).toBeTruthy();
    expect(screen.queryByText(/enable location/i)).toBeNull();
  });

  it("adds the distance after the venue when location is on", () => {
    distance.mi = 3.2;
    const { container } = render(<GamePlaceDistance game={game} />);
    expect(container.textContent).toBe("Coolray Field · 3.2 mi");
  });

  it("falls back to the location prompt when the venue is unknown", () => {
    render(<GamePlaceDistance game={{ ...(game as object), location: "TBD" } as never} />);
    expect(screen.getByRole("button", { name: /enable location/i })).toBeTruthy();
  });
});

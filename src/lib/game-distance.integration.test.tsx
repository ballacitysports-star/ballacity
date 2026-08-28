// Integration tests: the distance rendered on a card and the distance used by
// feed sorting must come from the same shared viewer-location value.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameDistance } from "@/components/GameDistance";
import { gameDistanceMi } from "@/lib/game-distance";
import { __resetViewerLocationForTests, getViewerLocation, requestViewerLocation } from "@/lib/geo";

vi.mock("@/lib/location-denial-telemetry", () => ({ recordDenial: vi.fn(async () => {}) }));
vi.mock("@/lib/measurement-system", async (orig) => {
  const mod = (await orig()) as Record<string, unknown>;
  return mod;
});

type TestGame = {
  id: string;
  lat: number | null;
  lng: number | null;
  pseudoGeo?: boolean;
  distanceMi?: number | null;
};

const VIEWER = { lat: 40.7128, lng: -74.006 }; // NYC

const GAMES: TestGame[] = [
  { id: "far", lat: 40.9, lng: -74.2 },
  { id: "near", lat: 40.72, lng: -74.01 },
  { id: "mid", lat: 40.8, lng: -74.1 },
  { id: "no-venue", lat: null, lng: null },
];

function grantLocation(coords = VIEWER) {
  (navigator as unknown as { geolocation: unknown }).geolocation = {
    getCurrentPosition: (ok: (p: unknown) => void) =>
      ok({ coords: { latitude: coords.lat, longitude: coords.lng } }),
  };
  act(() => requestViewerLocation());
}

function denyLocation() {
  (navigator as unknown as { geolocation: unknown }).geolocation = {
    getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) => fail({ code: 1 }),
  };
  act(() => requestViewerLocation());
}

/** Renders every game's card distance, as the feed does. */
function List({ games }: { games: TestGame[] }) {
  return (
    <ul>
      {games.map((g) => (
        <li key={g.id}>
          <span data-testid={`d-${g.id}`}>
            <GameDistance game={g as never} decimals={3} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function nearestOrder(games: TestGame[]) {
  const coords = getViewerLocation().coords;
  return [...games]
    .sort(
      (a, b) =>
        (gameDistanceMi(a as never, coords) ?? Infinity) -
        (gameDistanceMi(b as never, coords) ?? Infinity),
    )
    .map((g) => g.id);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  __resetViewerLocationForTests();
});

afterEach(() => {
  cleanup();
  __resetViewerLocationForTests();
});

describe("live distance + feed sorting parity", () => {
  it("prompts to enable location before any position is shared", () => {
    render(<List games={GAMES} />);
    expect(screen.getByTestId("d-near").textContent).toContain("Enable location");
    expect(screen.getByTestId("d-no-venue").textContent).toContain("Distance unavailable");
  });

  it("renders the exact value that nearest sorting uses", () => {
    render(<List games={GAMES} />);
    grantLocation();

    const coords = getViewerLocation().coords;
    expect(coords).toEqual(VIEWER);

    for (const g of GAMES.filter((x) => x.lat != null)) {
      const mi = gameDistanceMi(g as never, coords)!;
      const rendered = screen.getByTestId(`d-${g.id}`).textContent ?? "";
      // Card text carries the same rounded value the sort key derives from.
      expect(rendered).toContain(mi.toFixed(3));
    }

    expect(nearestOrder(GAMES)).toEqual(["near", "mid", "far", "no-venue"]);
  });

  it("keeps every card on one shared location value", () => {
    render(<List games={GAMES} />);
    grantLocation();
    const first = screen.getByTestId("d-near").textContent;

    // A second position updates all cards at once (single store, no per-card state).
    grantLocation({ lat: 40.8, lng: -74.1 });
    expect(screen.getByTestId("d-near").textContent).not.toEqual(first);
    const mi = gameDistanceMi(GAMES[1] as never, getViewerLocation().coords)!;
    expect(screen.getByTestId("d-near").textContent).toContain(mi.toFixed(3));
  });

  it("remembers the last granted location and offers a refresh", () => {
    render(<List games={GAMES} />);
    grantLocation();
    cleanup();

    // Simulate a new session: store reset, remembered fix is older than the TTL.
    __resetViewerLocationForTests();
    const stale = { at: Date.now() - 60 * 60 * 1000, coords: VIEWER };
    window.localStorage.setItem("openrun.userLoc.v1", JSON.stringify(stale));
    window.sessionStorage.clear();

    render(<List games={GAMES} />);
    expect(getViewerLocation().coords).toEqual(VIEWER);
    expect(getViewerLocation().remembered).toBe(true);
    const text = screen.getByTestId("d-near").textContent ?? "";
    expect(text).toContain("approx");
    expect(text).toContain("Refresh");
    // Distances still resolve, so sorting stays stable across a reload.
    expect(nearestOrder(GAMES)).toEqual(["near", "mid", "far", "no-venue"]);
  });

  it("explains a denial, offers a retry, and keeps remembered coordinates", () => {
    render(<List games={GAMES} />);
    denyLocation();
    expect(screen.getByTestId("d-near").textContent).toContain("Retry location");
    expect(screen.getByTestId("d-near").querySelector("button")?.getAttribute("title")).toMatch(
      /site settings/i,
    );

    // Retrying after the user unblocks re-requests and restores distances.
    grantLocation();
    const mi = gameDistanceMi(GAMES[1] as never, getViewerLocation().coords)!;
    expect(screen.getByTestId("d-near").textContent).toContain(mi.toFixed(3));
  });

  it("says why a venue without coordinates has no distance", () => {
    render(<List games={GAMES} />);
    grantLocation();
    const cell = screen.getByTestId("d-no-venue");
    expect(cell.textContent).toContain("Distance unavailable");
    expect(cell.querySelector("span")?.getAttribute("title")).toMatch(/mappable address/i);
  });
});

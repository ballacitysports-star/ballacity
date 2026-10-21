import { describe, expect, it } from "vitest";
import type { Game } from "@/lib/sample-data";
import {
  FACILITY_EVENT_KINDS,
  classifyFacilityEvent,
  defaultFacilityEventTitle,
  upcomingFacilityEvents,
} from "@/lib/facility-events";

const NOW = new Date("2026-10-06T12:00:00Z").getTime();

function game(over: Partial<Game>): Game {
  return {
    id: "g",
    sport: "Basketball",
    title: "Run",
    date: "2026-10-07T18:00:00Z",
    duration: "90 min",
    isPrivate: false,
    ...over,
  } as Game;
}

describe("classifyFacilityEvent", () => {
  it("recognizes each kind from the title", () => {
    expect(classifyFacilityEvent({ title: "Fall Hoops Tournament" })).toBe("tournament");
    expect(classifyFacilityEvent({ title: "Youth skills clinic" })).toBe("clinic");
    expect(classifyFacilityEvent({ title: "Open Court Session" })).toBe("open_court");
    expect(classifyFacilityEvent({ title: "Open gym" })).toBe("open_court");
    expect(classifyFacilityEvent({ title: "Tuesday night run" })).toBe("run");
  });

  it("round-trips every default title it generates", () => {
    for (const k of FACILITY_EVENT_KINDS) {
      expect(classifyFacilityEvent({ title: defaultFacilityEventTitle(k.kind, "Peak Gym") })).toBe(
        k.kind,
      );
    }
  });
});

describe("upcomingFacilityEvents", () => {
  it("drops cancelled, private and finished events and sorts soonest first", () => {
    const rows = upcomingFacilityEvents(
      [
        game({ id: "later", date: "2026-10-09T18:00:00Z" }),
        game({ id: "past", date: "2026-10-01T18:00:00Z" }),
        game({ id: "cancelled", cancelledAt: "2026-10-05T00:00:00Z" }),
        game({ id: "private", isPrivate: true }),
        game({ id: "soon", date: "2026-10-07T18:00:00Z" }),
      ],
      NOW,
    );
    expect(rows.map((g) => g.id)).toEqual(["soon", "later"]);
  });

  it("lists a multi-day series once, at its next session", () => {
    const rows = upcomingFacilityEvents(
      [
        game({ id: "d2", date: "2026-10-09T18:00:00Z", seriesId: "s" }),
        game({ id: "d1", date: "2026-10-08T18:00:00Z", seriesId: "s" }),
        game({ id: "solo", date: "2026-10-10T18:00:00Z" }),
      ],
      NOW,
    );
    expect(rows.map((g) => g.id)).toEqual(["d1", "solo"]);
    expect(rows[0].seriesCount).toBe(2);
  });

  it("keeps an event that is in progress", () => {
    const rows = upcomingFacilityEvents([game({ id: "live", date: "2026-10-06T11:30:00Z" })], NOW);
    expect(rows.map((g) => g.id)).toEqual(["live"]);
  });
});

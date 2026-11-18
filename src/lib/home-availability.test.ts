import { describe, expect, it } from "vitest";
import {
  parseHomeAvailabilitySetting,
  sportsLabel,
  summarizeHomeAvailability,
  type HomePost,
} from "./home-availability";

/** WP 1.6: the Home card speaks about one post, with My availability's rules, and the switch is on unless set to false. */
const NOW = new Date("2026-11-18T17:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const weekly = (id: string, confirmedDaysAgo: number, over: Partial<HomePost> = {}): HomePost => ({
  id,
  status: "open",
  sports: ["Basketball"],
  time_slots: [{ weekday: 2, start: "18:00", end: "20:00" }],
  timezone: "America/New_York",
  last_confirmed_at: ago(confirmedDaysAgo),
  ...over,
});
const dated = (id: string, date: string, over: Partial<HomePost> = {}): HomePost => ({
  id,
  status: "open",
  sports: ["Soccer"],
  time_slots: [{ date, start: "18:00", end: "20:00" }],
  timezone: "America/New_York",
  last_confirmed_at: ago(1),
  ...over,
});

describe("the home_availability_first switch", () => {
  it("is on unless the row says enabled: false", () => {
    expect(parseHomeAvailabilitySetting(undefined)).toBe(true);
    expect(parseHomeAvailabilitySetting(null)).toBe(true);
    expect(parseHomeAvailabilitySetting({ enabled: true })).toBe(true);
    expect(parseHomeAvailabilitySetting({ enabled: "false" })).toBe(true);
    expect(parseHomeAvailabilitySetting("off")).toBe(true);
    expect(parseHomeAvailabilitySetting({ enabled: false })).toBe(false);
  });
});

describe("summarizeHomeAvailability", () => {
  it("no posts, or only paused, closed or past dated ones: invite the member to post", () => {
    expect(summarizeHomeAvailability([], NOW)).toEqual({ kind: "none" });
    expect(
      summarizeHomeAvailability(
        [
          weekly("p", 1, { status: "paused" }),
          weekly("c", 1, { status: "closed" }),
          weekly("i", 1, { status: "inactive" }),
          dated("old", "2026-11-10"),
        ],
        NOW,
      ),
    ).toEqual({ kind: "none" });
  });

  it("a listed post: the one listed longest, with how many others", () => {
    const s = summarizeHomeAvailability(
      [weekly("a", 5), dated("b", "2026-11-25"), weekly("c", 2)],
      NOW,
    );
    expect(s.kind).toBe("listed");
    if (s.kind !== "listed") return;
    expect(s.post.id).toBe("c");
    expect(s.count).toBe(3);
    expect(s.listing.label).toMatch(/^Listed until /);
  });

  it("a weekly post about to run out comes first and can be reconfirmed", () => {
    const s = summarizeHomeAvailability([weekly("fresh", 1), weekly("soon", 12)], NOW);
    expect(s.kind).toBe("attention");
    if (s.kind !== "attention") return;
    expect(s.post.id).toBe("soon");
    expect(s.listing.canReconfirm).toBe(true);
    expect(s.count).toBe(2);
  });

  it("a weekly post that ran out (or was marked expired) asks to be reconfirmed", () => {
    for (const p of [weekly("old", 20), weekly("exp", 3, { status: "expired" })]) {
      const s = summarizeHomeAvailability([p], NOW);
      expect(s.kind).toBe("attention");
      if (s.kind === "attention") expect(s.listing.canReconfirm).toBe(true);
    }
  });

  it("of two posts running out, the sooner one", () => {
    const s = summarizeHomeAvailability([weekly("later", 11), weekly("sooner", 13)], NOW);
    expect(s.kind === "attention" && s.post.id).toBe("sooner");
  });
});

describe("sportsLabel", () => {
  it("names up to two sports and counts the rest", () => {
    expect(sportsLabel([])).toBe("Your availability");
    expect(sportsLabel(null)).toBe("Your availability");
    expect(sportsLabel(["Basketball"])).toBe("Basketball");
    expect(sportsLabel(["Basketball", "Soccer"])).toBe("Basketball and Soccer");
    expect(sportsLabel(["Basketball", "Soccer", "Tennis", "Running"])).toBe(
      "Basketball, Soccer and 2 more",
    );
  });
});

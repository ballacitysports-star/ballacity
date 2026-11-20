import { describe, expect, it } from "vitest";
import { formatGameWhen } from "./format";
import { buildNeedsAction, formatStartTime, type NeedsActionInput } from "./needs-action";

// 11:00 AM in New York (EDT), 8:00 AM in Los Angeles (PDT).
const NOW = new Date("2026-10-28T15:00:00Z");
const none: NeedsActionInput = {
  hostRequests: { count: 0, oldestGameId: null, oldestGameTitle: null },
  unreadMessages: 0,
  messageRequests: 0,
  gamesToday: [],
};
const build = (over: Partial<NeedsActionInput>) => buildNeedsAction({ ...none, ...over }, NOW);

describe("buildNeedsAction", () => {
  it("shows nothing when nothing is waiting", () => {
    expect(build({})).toEqual([]);
  });

  it("puts join requests first, linked to the game with the oldest one", () => {
    const [first] = build({
      unreadMessages: 3,
      hostRequests: { count: 2, oldestGameId: "g1", oldestGameTitle: "Friday run" },
    });
    expect(first).toMatchObject({
      id: "host-requests",
      label: "2 join requests to answer",
      detail: "Friday run",
      to: "/games/$gameId",
      params: { gameId: "g1" },
      tone: "urgent",
    });
  });

  it("uses the singular for one", () => {
    const [a] = build({ hostRequests: { count: 1, oldestGameId: "g", oldestGameTitle: "x" } });
    expect(a!.label).toBe("1 join request to answer");
    const [m] = build({ unreadMessages: 1 });
    expect(m!.label).toBe("1 unread message");
  });

  it("names the next game today and how many more follow", () => {
    const [t] = build({
      gamesToday: [
        { id: "a", title: "Pickup at Dyer", startsAt: "2026-10-28T22:30:00Z", role: "host" },
        { id: "b", title: "Late run", startsAt: "2026-10-29T01:00:00Z", role: "player" },
      ],
    });
    expect(t).toMatchObject({ id: "today", label: "Pickup at Dyer", params: { gameId: "a" } });
    expect(t!.detail).toMatch(/hosting/);
    expect(t!.detail).toMatch(/\+1 more game$/);
  });

  it("says Tomorrow for a game that starts after midnight", () => {
    const [t] = build({
      gamesToday: [{ id: "a", title: "Early", startsAt: "2026-10-29T11:00:00Z", role: "player" }],
    });
    expect(t!.detail).toMatch(/^Tomorrow /);
    expect(t!.detail).toMatch(/you're in/);
  });

  it("joins unread messages and requests into one row, urgent when a stranger is waiting", () => {
    const [m] = build({ unreadMessages: 3, messageRequests: 1 });
    expect(m).toMatchObject({
      id: "messages",
      label: "3 unread messages · 1 message request",
      tone: "urgent",
      to: "/messages",
    });
    expect(build({ unreadMessages: 3 })[0]!.tone).toBe("info");
  });

  it("keeps the order: requests, today, messages", () => {
    const ids = build({
      unreadMessages: 1,
      gamesToday: [{ id: "a", title: "t", startsAt: "2026-10-28T22:00:00Z", role: "host" }],
      hostRequests: { count: 1, oldestGameId: "g", oldestGameTitle: "t" },
    }).map((i) => i.id);
    expect(ids).toEqual(["host-requests", "today", "messages"]);
  });

  it("falls back to the feed when a request's game is unknown", () => {
    const [a] = build({ hostRequests: { count: 2, oldestGameId: null, oldestGameTitle: null } });
    expect(a!.to).toBe("/feed");
    expect(a!.params).toBeUndefined();
  });
});

describe("formatStartTime (WP 4.3: one zone policy with the game page)", () => {
  const NY = "America/New_York";
  const LA = "America/Los_Angeles";

  it("shows the time in the app zone the game page uses, unlabelled for a New York viewer", () => {
    // 22:30 UTC is 6:30 PM in New York and 3:30 PM in Los Angeles.
    expect(formatStartTime("2026-10-28T22:30:00Z", NOW, NY)).toBe("6:30 PM");
  });

  it("labels the zone when the viewer's device is elsewhere", () => {
    expect(formatStartTime("2026-10-28T22:30:00Z", NOW, LA)).toBe("6:30 PM EDT");
    expect(formatStartTime("2026-10-28T22:30:00Z", NOW, "Not/AZone")).toBe("6:30 PM EDT");
  });

  it("leaves the label off when the viewer's zone has the same offset", () => {
    expect(formatStartTime("2026-10-28T22:30:00Z", NOW, "America/Toronto")).toBe("6:30 PM");
  });

  it("decides today or tomorrow by the app zone's calendar day", () => {
    // 03:30 UTC on Oct 29 is 11:30 PM on Oct 28 in New York (today).
    expect(formatStartTime("2026-10-29T03:30:00Z", NOW, NY)).toBe("11:30 PM");
    expect(formatStartTime("2026-10-29T11:00:00Z", NOW, NY)).toBe("Tomorrow 7:00 AM");
  });

  it("says Yesterday for a game under way since before midnight", () => {
    const lateNight = new Date("2026-10-29T04:30:00Z"); // 12:30 AM Oct 29 in New York
    expect(formatStartTime("2026-10-29T03:00:00Z", lateNight, NY)).toBe("Yesterday 11:00 PM");
  });

  it("returns nothing for an unreadable time", () => {
    expect(formatStartTime("not a date", NOW, NY)).toBe("");
  });

  it("matches the game page's time for a game created in another zone (Chicago host)", () => {
    // A Chicago host's 6:30 PM CDT game: 23:30 UTC, which the game page shows as 7:30 PM (New York).
    const startsAt = "2026-10-28T23:30:00Z";
    const pageTime = formatGameWhen({ date: startsAt }).split(" · ").pop();
    expect(pageTime).toBe("7:30 PM");
    expect(formatStartTime(startsAt, NOW, NY)).toBe(pageTime);
    expect(formatStartTime(startsAt, NOW, "America/Chicago")).toBe(`${pageTime} EDT`);
  });
});

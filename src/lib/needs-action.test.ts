import { describe, expect, it } from "vitest";
import { buildNeedsAction, type NeedsActionInput } from "./needs-action";

const NOW = new Date("2026-10-28T15:00:00");
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
        { id: "a", title: "Pickup at Dyer", startsAt: "2026-10-28T18:30:00", role: "host" },
        { id: "b", title: "Late run", startsAt: "2026-10-28T21:00:00", role: "player" },
      ],
    });
    expect(t).toMatchObject({ id: "today", label: "Pickup at Dyer", params: { gameId: "a" } });
    expect(t!.detail).toMatch(/hosting/);
    expect(t!.detail).toMatch(/\+1 more game$/);
  });

  it("says Tomorrow for a game that starts after midnight", () => {
    const [t] = build({
      gamesToday: [{ id: "a", title: "Early", startsAt: "2026-10-29T07:00:00", role: "player" }],
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
      gamesToday: [{ id: "a", title: "t", startsAt: "2026-10-28T18:00:00", role: "host" }],
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

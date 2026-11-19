import { describe, expect, it } from "vitest";
import {
  bulkInviteMessage,
  candidateState,
  inviteCounts,
  inviteSearchFor,
  inviteSportFor,
} from "./host-invites";
import type { GameInvite } from "./game-invites";

/** WP 2.1: who the host is offered to invite, for which search, and how the outcome reads. */
const NOW = new Date("2026-11-20T12:00:00Z");
const game = (over: Record<string, unknown> = {}) =>
  ({
    id: "g1",
    sport: "Basketball",
    date: "2026-11-21T23:00:00Z",
    duration: "90 min",
    lat: 34.12,
    lng: -84.0,
    ...over,
  }) as Parameters<typeof inviteSearchFor>[0];
const invite = (over: Partial<GameInvite>): GameInvite => ({
  id: "i",
  game_id: "g1",
  host_id: "host",
  invitee_id: "u1",
  availability_id: null,
  message: null,
  status: "pending",
  join_request_id: null,
  created_at: "2026-11-19T12:00:00Z",
  responded_at: null,
  ...over,
});

describe("inviteSportFor", () => {
  it("maps a game's sport to the posts' name, whatever the case", () => {
    expect(inviteSportFor("basketball")).toBe("Basketball");
    expect(inviteSportFor("Basketball")).toBe("Basketball");
    expect(inviteSportFor(" SOCCER ")).toBe("Soccer");
    expect(inviteSportFor("quidditch")).toBeNull();
    expect(inviteSportFor("")).toBeNull();
  });
});

describe("inviteSearchFor", () => {
  it("searches near the game, over its time, for its sport, nearest first, up to 30", () => {
    const s = inviteSearchFor(game(), NOW);
    expect(s).toEqual({
      ok: true,
      query: {
        lat: 34.12,
        lng: -84.0,
        radiusMi: 25,
        sport: "Basketball",
        from: "2026-11-21T23:00:00.000Z",
        to: "2026-11-22T00:30:00.000Z",
        includeUnlocated: false,
        order: "nearest",
        limit: 30,
      },
    });
  });

  it("uses an explicit end time when the game has one", () => {
    const s = inviteSearchFor(game({ endsAt: "2026-11-22T02:00:00Z" }), NOW);
    expect(s.ok && s.query.to).toBe("2026-11-22T02:00:00.000Z");
  });

  it("offers nothing for a game that started, ended or was cancelled", () => {
    expect(inviteSearchFor(game({ date: "2026-11-20T11:30:00Z" }), NOW)).toEqual({
      ok: false,
      reason: "finished",
    });
    expect(inviteSearchFor(game({ cancelledAt: "2026-11-19T00:00:00Z" }), NOW)).toEqual({
      ok: false,
      reason: "finished",
    });
    expect(inviteSearchFor(game({ status: "completed" }), NOW)).toEqual({
      ok: false,
      reason: "finished",
    });
  });

  it("cannot search by distance without the game's place", () => {
    expect(inviteSearchFor(game({ lat: null, lng: null }), NOW)).toEqual({
      ok: false,
      reason: "no_location",
    });
  });
});

describe("candidateState", () => {
  const ctx = (invites: GameInvite[] = [], rosterIds: string[] = []) => ({
    hostId: "host",
    rosterIds,
    invites,
  });

  it("an available player with no history can be invited", () => {
    expect(candidateState("u1", ctx(), NOW)).toBeNull();
  });

  it("marks the roster, a waiting or accepted invitation, and a decline this week", () => {
    expect(candidateState("u1", ctx([], ["u1"]), NOW)).toBe("on_roster");
    expect(candidateState("u1", ctx([invite({ status: "pending" })]), NOW)).toBe("invited");
    expect(candidateState("u1", ctx([invite({ status: "accepted" })]), NOW)).toBe("joined");
    expect(
      candidateState(
        "u1",
        ctx([invite({ status: "declined", responded_at: "2026-11-18T12:00:00Z" })]),
        NOW,
      ),
    ).toBe("declined_recently");
  });

  it("a decline over a week ago, or a withdrawn or ended invitation, leaves the player invitable", () => {
    expect(
      candidateState(
        "u1",
        ctx([invite({ status: "declined", responded_at: "2026-11-10T12:00:00Z" })]),
        NOW,
      ),
    ).toBeNull();
    expect(
      candidateState(
        "u1",
        ctx([invite({ status: "cancelled" }), invite({ status: "expired" })]),
        NOW,
      ),
    ).toBeNull();
  });

  it("never offers the host", () => {
    expect(candidateState("host", ctx(), NOW)).toBe("host");
  });
});

describe("inviteCounts", () => {
  it("counts waiting, accepted, declined and the rest", () => {
    expect(
      inviteCounts([
        invite({ status: "pending" }),
        invite({ status: "pending" }),
        invite({ status: "accepted" }),
        invite({ status: "declined" }),
        invite({ status: "cancelled" }),
      ]),
    ).toEqual({ pending: 2, accepted: 1, declined: 1, ended: 1 });
  });
});

describe("bulkInviteMessage", () => {
  it("says how many were invited and why the rest were not", () => {
    expect(bulkInviteMessage({ invited: 3, skipped: {} })).toBe("Invited 3 players.");
    expect(bulkInviteMessage({ invited: 1, skipped: { INVITE_NOT_AVAILABLE: 2 } })).toBe(
      "Invited 1 player. 2 can't be invited.",
    );
    expect(
      bulkInviteMessage({ invited: 0, skipped: { ALREADY_IN_GAME: 1, SOMETHING_NEW: 1 } }),
    ).toBe("No one was invited. 1 already has a spot, 1 couldn't be invited.");
  });
});

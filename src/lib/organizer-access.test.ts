import { describe, expect, it } from "vitest";
import {
  GAMES_READ,
  JOIN_REQUESTS_READ,
  inviteMatchesHost,
  stripMaskedColumns,
  viewerHostsGame,
} from "./organizer-access";

describe("SEC-5 organizer access helpers", () => {
  it("names the masked read views", () => {
    expect(GAMES_READ).toBe("hosted_games_public");
    expect(JOIN_REQUESTS_READ).toBe("join_requests_visible");
  });

  it("decides 'my game' from viewer_is_host, with the id only as a fallback for local games", () => {
    expect(viewerHostsGame({ viewerIsHost: true }, "me")).toBe(true);
    expect(viewerHostsGame({ viewerIsHost: true, hostUserId: undefined }, null)).toBe(true);
    expect(viewerHostsGame({ hostUserId: "me" }, "me")).toBe(true);
    expect(viewerHostsGame({ viewerIsHost: false, hostUserId: undefined }, "me")).toBe(false);
    expect(viewerHostsGame({ hostUserId: "other" }, "me")).toBe(false);
    expect(viewerHostsGame({ hostUserId: "me" }, null)).toBe(false);
    expect(viewerHostsGame(null, "me")).toBe(false);
  });

  it("drops host_id and image from a realtime row and keeps the rest", () => {
    const row = {
      id: "g1",
      host_id: "minor-account",
      image: "storage://game-covers/minor-account/c.jpg",
      title: "Run",
    };
    const out = stripMaskedColumns(row);
    expect(out).toEqual({ id: "g1", title: "Run" });
    expect(JSON.stringify(out)).not.toContain("minor-account");
    expect(stripMaskedColumns(null)).toBeNull();
  });

  it("checks an invite's sender against the host only when the viewer may know the host", () => {
    expect(inviteMatchesHost(undefined, "host")).toBe(false);
    expect(inviteMatchesHost("", null)).toBe(false);
    expect(inviteMatchesHost("host", "host")).toBe(true);
    expect(inviteMatchesHost("someone-else", "host")).toBe(false);
    // masked host: the database names the host on the request, so the link is not refused here
    expect(inviteMatchesHost("inviter", null)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  blockedByLocationHold,
  closesReport,
  hasOpenLocationHold,
  locationHoldRpc,
} from "./location-hold";

const held = { reason: "location_disclosed", gameId: "g1", locationHold: true };

describe("location-disclosure holds", () => {
  it("knows which statuses close a report", () => {
    expect(closesReport("resolved")).toBe(true);
    expect(closesReport("dismissed")).toBe(true);
    expect(closesReport("investigating")).toBe(false);
    expect(closesReport("escalated")).toBe(false);
  });

  it("sees an open hold only on a held location report about a game", () => {
    expect(hasOpenLocationHold(held)).toBe(true);
    expect(hasOpenLocationHold({ ...held, locationHold: false })).toBe(false);
    expect(hasOpenLocationHold({ ...held, reason: "spam" })).toBe(false);
    expect(hasOpenLocationHold({ ...held, gameId: null })).toBe(false);
  });

  it("blocks closing a held report through the generic actions", () => {
    expect(blockedByLocationHold(held, { status: "resolved" })).toBe(true);
    expect(blockedByLocationHold(held, { status: "dismissed" })).toBe(true);
    expect(blockedByLocationHold(held, { action: "remove_content" })).toBe(true);
    expect(blockedByLocationHold(held, { action: "restore" })).toBe(true);
  });

  it("still allows investigating or escalating it, and leaves other reports alone", () => {
    expect(blockedByLocationHold(held, { status: "investigating" })).toBe(false);
    expect(blockedByLocationHold(held, { status: "escalated" })).toBe(false);
    expect(blockedByLocationHold({ ...held, locationHold: false }, { status: "resolved" })).toBe(
      false,
    );
  });

  it("maps each decision to the database function that releases the hold", () => {
    expect(locationHoldRpc("restore")).toBe("moderator_restore_game_text");
    expect(locationHoldRpc("confirm")).toBe("moderator_confirm_location_hold");
  });
});

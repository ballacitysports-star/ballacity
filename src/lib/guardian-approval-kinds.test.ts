import { describe, expect, it } from "vitest";
import { PENDING_APPROVAL_KINDS, parseNotifyGuardiansInput } from "./guardian-approval-kinds";

/**
 * The server function's input (notifyGuardiansOfPending). Every caller in the unit tests mocks that module, so the
 * kinds it accepts are checked here: a kind the client sends but the server refuses would be swallowed by the
 * fire-and-forget ping, and no guardian would ever be told.
 */
describe("parseNotifyGuardiansInput", () => {
  it("accepts every kind the app pings with, including a held invitation accept", () => {
    expect([...PENDING_APPROVAL_KINDS].sort()).toEqual(
      ["invite_accept", "join_request", "team_invite"].sort(),
    );
    for (const kind of PENDING_APPROVAL_KINDS) {
      expect(parseNotifyGuardiansInput({ kind, id: "abc" })).toEqual({ kind, id: "abc" });
    }
  });

  it("refuses an unknown kind, an empty id and an oversized one", () => {
    expect(() => parseNotifyGuardiansInput({ kind: "game_invite", id: "abc" })).toThrow();
    expect(() => parseNotifyGuardiansInput({ kind: "invite_accept", id: "" })).toThrow();
    expect(() =>
      parseNotifyGuardiansInput({ kind: "invite_accept", id: "x".repeat(65) }),
    ).toThrow();
  });
});

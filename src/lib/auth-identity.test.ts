import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  identityAfter,
  isIdentityChange,
  trackIdentity,
  type SeenIdentity,
} from "@/lib/auth-identity";

const session = (id: string) => ({ access_token: `t-${id}`, user: { id } }) as unknown as Session;

/**
 * Replays events through the same gate the root layout and the org and
 * hosted-games stores use, and counts the reloads they would run.
 */
function reloadsFor(events: Array<[AuthChangeEvent, Session | null]>): number {
  let seen: SeenIdentity = undefined;
  let reloads = 0;
  for (const [event, s] of events) {
    const step = trackIdentity(seen, event, s);
    seen = step.seen;
    if (step.changed) reloads += 1;
  }
  return reloads;
}

describe("isIdentityChange", () => {
  it("never reloads for a re-emitted SIGNED_IN after INITIAL_SESSION named the member", () => {
    // A listener that subscribed after the client started (the root layout):
    // its first event is INITIAL_SESSION, then other tabs opening or this tab
    // becoming visible again re-emit SIGNED_IN for the same member.
    expect(
      reloadsFor([
        ["INITIAL_SESSION", session("a")],
        ["SIGNED_IN", session("a")],
        ["SIGNED_IN", session("a")],
        ["TOKEN_REFRESHED", session("a")],
        ["SIGNED_IN", session("a")],
      ]),
    ).toBe(0);
  });

  it("reloads once for a member whose start-up SIGNED_IN comes before INITIAL_SESSION", () => {
    // A listener registered before the client started (the module-level stores).
    expect(
      reloadsFor([
        ["SIGNED_IN", session("a")],
        ["INITIAL_SESSION", session("a")],
        ["SIGNED_IN", session("a")],
        ["SIGNED_IN", session("a")],
      ]),
    ).toBe(1);
  });

  it("reloads when someone signs in after a signed-out INITIAL_SESSION", () => {
    expect(
      reloadsFor([
        ["INITIAL_SESSION", null],
        ["SIGNED_IN", session("a")],
        ["SIGNED_IN", session("a")],
      ]),
    ).toBe(1);
  });

  it("reloads when INITIAL_SESSION named one member and another signs in", () => {
    expect(
      reloadsFor([
        ["INITIAL_SESSION", session("a")],
        ["SIGNED_IN", session("b")],
      ]),
    ).toBe(1);
  });

  it("reloads again when a different member signs in", () => {
    expect(
      reloadsFor([
        ["SIGNED_IN", session("a")],
        ["SIGNED_IN", session("a")],
        ["SIGNED_IN", session("b")],
        ["SIGNED_IN", session("b")],
      ]),
    ).toBe(2);
  });

  it("reloads after a sign-out and the same member signing back in", () => {
    expect(
      reloadsFor([
        ["SIGNED_IN", session("a")],
        ["SIGNED_OUT", null],
        ["SIGNED_IN", session("a")],
      ]),
    ).toBe(3);
  });

  it("always counts USER_UPDATED and SIGNED_OUT", () => {
    expect(isIdentityChange("a", "USER_UPDATED", session("a"))).toBe(true);
    expect(isIdentityChange("a", "SIGNED_OUT", null)).toBe(true);
  });

  it("counts the first SIGNED_IN a listener sees, so a page still reloads once", () => {
    expect(isIdentityChange(undefined, "SIGNED_IN", session("a"))).toBe(true);
    // Signed out at load, then signed in from another tab.
    expect(isIdentityChange(null, "SIGNED_IN", session("a"))).toBe(true);
  });

  it("never counts token refreshes or the initial session", () => {
    expect(isIdentityChange(undefined, "INITIAL_SESSION", session("a"))).toBe(false);
    expect(isIdentityChange(undefined, "TOKEN_REFRESHED", session("a"))).toBe(false);
    expect(isIdentityChange("a", "TOKEN_REFRESHED", session("b"))).toBe(false);
  });

  it("seeds the identity from INITIAL_SESSION only when nothing was seen yet", () => {
    expect(trackIdentity(undefined, "INITIAL_SESSION", session("a"))).toEqual({
      changed: false,
      seen: "a",
    });
    expect(trackIdentity(undefined, "INITIAL_SESSION", null)).toEqual({
      changed: false,
      seen: null,
    });
    expect(trackIdentity("b", "INITIAL_SESSION", session("a"))).toEqual({
      changed: false,
      seen: "b",
    });
  });

  it("remembers null after a sign-out and the user id otherwise", () => {
    expect(identityAfter("SIGNED_OUT", session("a"))).toBeNull();
    expect(identityAfter("SIGNED_IN", session("a"))).toBe("a");
  });
});

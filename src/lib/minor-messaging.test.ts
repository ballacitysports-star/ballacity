import { describe, expect, it } from "vitest";
import {
  describeMessagingError,
  isMinorMessagingBlock,
  minorMessagingMessage,
  parseMinorMessagingBlock,
  parseMinorMessagingReason,
} from "./minor-messaging";

const ALL_CODES = [
  "messaging_off",
  "guardian_only",
  "teammates_only",
  "child_needs_guardian",
  "child_needs_shared_game",
  "teen_needs_shared_game",
] as const;
const RECIPIENTS = ["player", "game_player", "host", "team_leader", "guardian", "chat"] as const;

describe("parseMinorMessagingReason", () => {
  it("reads the code out of a raised error", () => {
    expect(
      parseMinorMessagingReason(new Error("MINOR_MESSAGING_BLOCKED:teen_needs_shared_game")),
    ).toBe("teen_needs_shared_game");
  });

  it("finds the code inside the wrapping Postgres and PostgREST add", () => {
    const raised = new Error(
      "invalid request: MINOR_MESSAGING_BLOCKED:guardian_only (SQLSTATE P0001)",
    );
    expect(parseMinorMessagingReason(raised)).toBe("guardian_only");
  });

  it("accepts a bare string as well as an Error", () => {
    expect(parseMinorMessagingReason("MINOR_MESSAGING_BLOCKED:messaging_off")).toBe(
      "messaging_off",
    );
  });

  it("returns null for an unrelated failure", () => {
    expect(parseMinorMessagingReason(new Error("Could not start conversation."))).toBeNull();
    expect(parseMinorMessagingReason(null)).toBeNull();
  });

  it("ignores the side when reading just the code", () => {
    expect(parseMinorMessagingReason("MINOR_MESSAGING_BLOCKED:messaging_off:self")).toBe(
      "messaging_off",
    );
  });

  it("returns null for a code this build does not know", () => {
    expect(parseMinorMessagingReason("MINOR_MESSAGING_BLOCKED:some_future_rule")).toBeNull();
  });
});

describe("parseMinorMessagingBlock", () => {
  it("reads whose restriction it is", () => {
    expect(
      parseMinorMessagingBlock(
        "invalid request: MINOR_MESSAGING_BLOCKED:teen_needs_shared_game:self (SQLSTATE P0001)",
      ),
    ).toEqual({ reason: "teen_needs_shared_game", side: "self" });
    expect(parseMinorMessagingBlock("MINOR_MESSAGING_BLOCKED:guardian_only:other")).toEqual({
      reason: "guardian_only",
      side: "other",
    });
  });

  it("leaves the side unknown for an older database", () => {
    expect(parseMinorMessagingBlock("MINOR_MESSAGING_BLOCKED:messaging_off")).toEqual({
      reason: "messaging_off",
      side: null,
    });
  });

  it("reads a Supabase error object that is not an Error instance", () => {
    expect(
      parseMinorMessagingBlock({ message: "MINOR_MESSAGING_BLOCKED:messaging_off:other" }),
    ).toEqual({ reason: "messaging_off", side: "other" });
  });
});

describe("minorMessagingMessage", () => {
  it("tells a host messaging a requester that the player must be in their game", () => {
    // The case that prompted this: a host who simply needs the player to join.
    const msg = minorMessagingMessage(
      "MINOR_MESSAGING_BLOCKED:teen_needs_shared_game:other",
      "game_player",
    )!;
    expect(msg).toMatch(/their spot in your game is confirmed/i);
  });

  it("tells a player messaging a host to wait for their spot, not for themselves", () => {
    for (const block of [
      "teen_needs_shared_game:self",
      "child_needs_shared_game:self",
      // Older databases do not say whose rule it is; the host wording still fits.
      "teen_needs_shared_game",
    ]) {
      const msg = minorMessagingMessage(`MINOR_MESSAGING_BLOCKED:${block}`, "host")!;
      expect(msg, block).toBe("You can message the host once your spot in this game is confirmed.");
    }
  });

  it("speaks about the viewer's own account when the restriction is theirs", () => {
    expect(minorMessagingMessage("MINOR_MESSAGING_BLOCKED:messaging_off:self", "host")).toMatch(
      /^Your parent or guardian has turned off/,
    );
    expect(minorMessagingMessage("MINOR_MESSAGING_BLOCKED:teammates_only:self")).toMatch(
      /^Your parent or guardian .* only message teammates/,
    );
    expect(minorMessagingMessage("MINOR_MESSAGING_BLOCKED:child_needs_guardian:self")).toMatch(
      /can only message their own parent or guardian/,
    );
    for (const code of ALL_CODES) {
      for (const to of RECIPIENTS) {
        const msg = minorMessagingMessage(`MINOR_MESSAGING_BLOCKED:${code}:self`, to)!;
        expect(msg, `${code} -> ${to}`).not.toMatch(
          /once they've joined|their parent or guardian|Add them/i,
        );
      }
    }
  });

  it("names the person being messaged when the restriction is theirs", () => {
    expect(minorMessagingMessage("MINOR_MESSAGING_BLOCKED:messaging_off:other", "host")).toBe(
      "This host's parent or guardian has turned off direct messages.",
    );
    expect(
      minorMessagingMessage("MINOR_MESSAGING_BLOCKED:guardian_only:other", "team_leader"),
    ).toBe("This team leader can only be messaged by their parent or guardian.");
    expect(minorMessagingMessage("MINOR_MESSAGING_BLOCKED:messaging_off:other", "chat")).toBe(
      "This person's parent or guardian has turned off direct messages.",
    );
  });

  it("only suggests adding to a team when the viewer is messaging a player", () => {
    expect(minorMessagingMessage("MINOR_MESSAGING_BLOCKED:teammates_only:other")).toMatch(
      /Add them to your team/,
    );
    expect(
      minorMessagingMessage("MINOR_MESSAGING_BLOCKED:teammates_only:other", "host"),
    ).not.toMatch(/Add them/);
  });

  it("never tells anyone but a host to wait for a player to join their games", () => {
    for (const code of ["child_needs_shared_game", "teen_needs_shared_game"]) {
      for (const to of RECIPIENTS) {
        for (const side of [":self", ":other", ""]) {
          const msg = minorMessagingMessage(`MINOR_MESSAGING_BLOCKED:${code}${side}`, to)!;
          if (to !== "game_player")
            expect(msg, `${code}${side} -> ${to}`).not.toMatch(/your game/i);
        }
      }
    }
  });

  it("names the guardian control when that is what refused", () => {
    expect(minorMessagingMessage("MINOR_MESSAGING_BLOCKED:messaging_off")).toMatch(
      /parent or guardian/i,
    );
    expect(minorMessagingMessage("MINOR_MESSAGING_BLOCKED:teammates_only")).toMatch(/teammates/i);
  });

  it("never claims messaging with minors is simply unavailable", () => {
    // The old copy said exactly that, and it was not true.
    for (const code of ALL_CODES) {
      for (const side of [":self", ":other", ""]) {
        for (const to of RECIPIENTS) {
          const msg = minorMessagingMessage(`MINOR_MESSAGING_BLOCKED:${code}${side}`, to)!;
          expect(msg, `${code}${side} -> ${to}`).not.toMatch(/between adults and minors/i);
          expect(msg, `${code}${side} -> ${to}`).not.toMatch(/MINOR_MESSAGING_BLOCKED|undefined/);
        }
      }
    }
  });

  it("falls back to a readable line for an unknown code", () => {
    const msg = minorMessagingMessage("MINOR_MESSAGING_BLOCKED:some_future_rule")!;
    expect(msg).toMatch(/safety settings/i);
    expect(msg).not.toMatch(/MINOR_MESSAGING_BLOCKED/);
  });

  it("never leaks the raw sentinel to a user", () => {
    for (const code of ["messaging_off", "some_future_rule", ""]) {
      const msg = minorMessagingMessage(`MINOR_MESSAGING_BLOCKED:${code}`);
      expect(msg, code).not.toMatch(/MINOR_MESSAGING_BLOCKED/);
    }
  });

  it("returns null when the error is something else entirely", () => {
    expect(minorMessagingMessage(new Error("network down"))).toBeNull();
  });
});

describe("isMinorMessagingBlock", () => {
  it("distinguishes this refusal from other failures", () => {
    expect(isMinorMessagingBlock("MINOR_MESSAGING_BLOCKED:messaging_off")).toBe(true);
    expect(isMinorMessagingBlock(new Error("This player is not accepting new messages."))).toBe(
      false,
    );
  });
});

describe("describeMessagingError", () => {
  it("explains a minor-messaging refusal", () => {
    expect(describeMessagingError(new Error("MINOR_MESSAGING_BLOCKED:guardian_only"))).toMatch(
      /parent or guardian/i,
    );
  });

  it("passes other errors through unchanged", () => {
    expect(describeMessagingError(new Error("This player is not accepting new messages."))).toBe(
      "This player is not accepting new messages.",
    );
  });

  it("uses the fallback when there is no message at all", () => {
    expect(describeMessagingError(undefined)).toBe("Couldn't open chat");
    expect(describeMessagingError(undefined, "Try again")).toBe("Try again");
  });
});

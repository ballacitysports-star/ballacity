import { describe, expect, it } from "vitest";
import {
  describeMessagingError,
  isMinorMessagingBlock,
  minorMessagingMessage,
  parseMinorMessagingReason,
} from "./minor-messaging";

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

  it("returns null for a code this build does not know", () => {
    expect(parseMinorMessagingReason("MINOR_MESSAGING_BLOCKED:some_future_rule")).toBeNull();
  });
});

describe("minorMessagingMessage", () => {
  it("explains that a shared game is what is missing, rather than refusing outright", () => {
    // The case that prompted this: a host who simply needs the player to join.
    const msg = minorMessagingMessage("MINOR_MESSAGING_BLOCKED:teen_needs_shared_game")!;
    expect(msg).toMatch(/joined one of your games/i);
  });

  it("tells a player messaging a host to wait for approval, not for themselves", () => {
    for (const code of ["teen_needs_shared_game", "child_needs_shared_game"]) {
      const msg = minorMessagingMessage(`MINOR_MESSAGING_BLOCKED:${code}`, "host")!;
      expect(msg, code).toMatch(/message the host once your spot .* is approved/i);
      expect(msg, code).not.toMatch(/your games/i);
    }
    expect(
      describeMessagingError(
        new Error("MINOR_MESSAGING_BLOCKED:teen_needs_shared_game"),
        undefined,
        "host",
      ),
    ).toMatch(/host/i);
  });

  it("keeps the host-independent reasons the same for either audience", () => {
    expect(minorMessagingMessage("MINOR_MESSAGING_BLOCKED:messaging_off", "host")).toBe(
      minorMessagingMessage("MINOR_MESSAGING_BLOCKED:messaging_off"),
    );
  });

  it("names the guardian control when that is what refused", () => {
    expect(minorMessagingMessage("MINOR_MESSAGING_BLOCKED:messaging_off")).toMatch(
      /parent or guardian/i,
    );
    expect(minorMessagingMessage("MINOR_MESSAGING_BLOCKED:teammates_only")).toMatch(/teammates/i);
  });

  it("never claims messaging with minors is simply unavailable", () => {
    // The old copy said exactly that, and it was not true.
    for (const code of [
      "messaging_off",
      "guardian_only",
      "teammates_only",
      "child_needs_guardian",
      "child_needs_shared_game",
      "teen_needs_shared_game",
    ]) {
      const msg = minorMessagingMessage(`MINOR_MESSAGING_BLOCKED:${code}`)!;
      expect(msg, code).not.toMatch(/between adults and minors/i);
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

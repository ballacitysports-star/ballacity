import { describe, expect, it } from "vitest";
import { formatHoldRemaining, holdExpiresAt } from "./payment-hold";

describe("holdExpiresAt", () => {
  const approvedAt = "2026-10-07T18:00:00.000Z";
  const later = "2026-10-08T02:00:00.000Z";

  it("adds the hold window to the approval time", () => {
    expect(
      holdExpiresAt({ approvedAt, holdMinutes: 120, gameStartsAt: later })?.toISOString(),
    ).toBe("2026-10-07T20:00:00.000Z");
  });

  it("is null without a hold, an approval, or when the hold outlasts tip-off", () => {
    expect(holdExpiresAt({ approvedAt, holdMinutes: null, gameStartsAt: later })).toBeNull();
    expect(holdExpiresAt({ approvedAt: null, holdMinutes: 120, gameStartsAt: later })).toBeNull();
    expect(
      holdExpiresAt({ approvedAt, holdMinutes: 120, gameStartsAt: "2026-10-07T19:30:00.000Z" }),
    ).toBeNull();
  });
});

describe("formatHoldRemaining", () => {
  it("formats hours and minutes", () => {
    expect(formatHoldRemaining(105 * 60_000)).toBe("1h 45m left to pay");
    expect(formatHoldRemaining(120 * 60_000)).toBe("2h left to pay");
    expect(formatHoldRemaining(12 * 60_000)).toBe("12m left to pay");
  });

  it("rounds a final partial minute up and reports expiry", () => {
    expect(formatHoldRemaining(10_000)).toBe("1m left to pay");
    expect(formatHoldRemaining(0)).toBe("Hold expired");
  });
});

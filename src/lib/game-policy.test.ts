import { describe, expect, it } from "vitest";
import {
  defaultGamePolicy,
  normalizeGamePolicy,
  validateGamePolicy,
  gamePolicyLines,
  HOST_ACK_ITEMS,
} from "./game-policy";

describe("game policy", () => {
  it("defaults to a runnable, waitlisted, flexible policy", () => {
    const p = defaultGamePolicy(10);
    expect(p.maxPlayers).toBe(10);
    expect(p.minPlayers).toBe(0);
    expect(p.allowWaitlist).toBe(true);
    expect(p.cancellationPolicy).toBe("flexible");
  });

  it("normalizes bad input instead of throwing", () => {
    const p = normalizeGamePolicy({ maxPlayers: 999, minPlayers: -4, entryFee: -2 });
    expect(p.maxPlayers).toBeLessThanOrEqual(30);
    expect(p.minPlayers).toBe(0);
    expect(p.entryFee).toBe(0);
  });

  it("rejects a minimum above the player limit", () => {
    const res = validateGamePolicy({ ...defaultGamePolicy(6), minPlayers: 8 });
    expect(res.ok).toBe(false);
  });

  it("requires wording for a custom cancellation policy", () => {
    const bad = validateGamePolicy(
      normalizeGamePolicy({ cancellationPolicy: "custom", cancellationNotes: "" }),
    );
    expect(bad.ok).toBe(false);
    const good = validateGamePolicy(
      normalizeGamePolicy({ cancellationPolicy: "custom", cancellationNotes: "Text me 2h ahead." }),
    );
    expect(good.ok).toBe(true);
  });

  it("always surfaces payment and approval as critical lines", () => {
    const lines = gamePolicyLines(
      normalizeGamePolicy({ entryFee: 12, requiresApproval: true, refundPolicy: "No refunds." }),
    );
    const critical = lines.filter((l) => l.critical).map((l) => l.label);
    expect(critical).toContain("Payment");
    expect(critical).toContain("Joining");
  });

  it("covers the eight host acknowledgment topics", () => {
    expect(HOST_ACK_ITEMS).toHaveLength(8);
    expect(new Set(HOST_ACK_ITEMS.map((i) => i.id)).size).toBe(8);
  });
});

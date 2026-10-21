import { describe, expect, it } from "vitest";
import {
  CANCELLATION_POLICIES,
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

describe("cancellation policy presets and the cutoff", () => {
  it("each named preset promises a cutoff that matches its label", () => {
    const byId = Object.fromEntries(CANCELLATION_POLICIES.map((p) => [p.id, p.cutoffMin]));
    expect(byId.standard).toBe(1440); // "Cancel 24h ahead"
    expect(byId.strict).toBeGreaterThan(byId.standard as number);
    expect(byId.custom).toBeNull(); // custom leaves the host's cutoff alone
  });
});

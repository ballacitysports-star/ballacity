import { describe, expect, it } from "vitest";
import {
  normalizeRefundPolicy,
  refundDisclaimer,
  refundPctFor,
  refundPhase,
  refundPolicySummary,
  refundTermsDisplay,
} from "./refund-policy";

const until = normalizeRefundPolicy("until_cutoff", 0);
const until50 = normalizeRefundPolicy("until_cutoff", 50);
const before = normalizeRefundPolicy("before_start", 25);
const none = normalizeRefundPolicy("none", 75);

describe("refundPctFor (mirrors the database)", () => {
  it("refunds in full before the cutoff and applies the late share inside it", () => {
    expect(refundPctFor(until, "player_cancelled", "early")).toBe(100);
    expect(refundPctFor(until, "player_cancelled", "late")).toBe(0);
    expect(refundPctFor(until50, "player_cancelled", "late")).toBe(50);
    expect(refundPctFor(until50, "no_show", "started")).toBe(50);
  });

  it("before_start refunds any cancel before start; no-shows get the share", () => {
    expect(refundPctFor(before, "player_cancelled", "late")).toBe(100);
    expect(refundPctFor(before, "player_cancelled", "started")).toBe(25);
    expect(refundPctFor(before, "no_show", "started")).toBe(25);
  });

  it("non-refundable keeps everything, but a host cancel always refunds in full", () => {
    expect(refundPctFor(none, "player_cancelled", "early")).toBe(0);
    expect(refundPctFor(none, "no_show", "started")).toBe(0);
    expect(refundPctFor(none, "game_cancelled", "late")).toBe(100);
  });
});

describe("refundPhase", () => {
  const now = Date.parse("2026-10-08T18:00:00Z");
  const at = (m: number) => new Date(now + m * 60_000).toISOString();
  it("splits early / late / started around the cutoff", () => {
    expect(refundPhase(at(180), 120, now)).toBe("early");
    expect(refundPhase(at(60), 120, now)).toBe("late");
    expect(refundPhase(at(-5), 120, now)).toBe("started");
    expect(refundPhase(at(60), 0, now)).toBe("early");
  });
});

describe("copy", () => {
  it("describes each rule in plain language", () => {
    expect(refundPolicySummary(until, 120)).toMatch(
      /Full refund if you cancel more than 2 hours before start\. After that, or if you don't show up, the fee is non-refundable\./,
    );
    expect(refundPolicySummary(until50, 1440)).toMatch(
      /more than 1 day before start.*you get 50% back/,
    );
    expect(refundPolicySummary(before, 120)).toMatch(
      /any time before start\. If you don't show up, you get 25% back/,
    );
    expect(refundPolicySummary(none, 120)).toMatch(/non-refundable once paid/);
    expect(refundDisclaimer(until, 120)).toMatch(
      /^I understand the refund terms: .*BallaCity doesn't hold or return money\.$/,
    );
  });

  it("falls back to the default rule and clamps the share", () => {
    expect(normalizeRefundPolicy("bogus", 250)).toEqual({ rule: "until_cutoff", latePct: 100 });
    expect(normalizeRefundPolicy(undefined, undefined)).toEqual({
      rule: "until_cutoff",
      latePct: 0,
    });
  });
});

describe("refundTermsDisplay", () => {
  it("returns null when the host has posted no terms, instead of a default rule", () => {
    expect(refundTermsDisplay(null, 60)).toBeNull();
    expect(refundTermsDisplay(undefined, 60)).toBeNull();
  });

  it("states non-refundable without any cutoff clause and keeps the host note separate", () => {
    const d = refundTermsDisplay(
      { refund_rule: "none", late_refund_pct: 0, refund_policy: "  All sales final.  " },
      120,
    )!;
    expect(d.summary).toMatch(/non-refundable/i);
    expect(d.summary).not.toMatch(/more than/i);
    expect(d.hostNote).toBe("All sales final.");
  });

  it("describes the cutoff rule when the host chose it", () => {
    const d = refundTermsDisplay(
      { refund_rule: "until_cutoff", late_refund_pct: 50, refund_policy: null },
      120,
    )!;
    expect(d.summary).toMatch(/more than 2 hours before start/);
    expect(d.summary).toMatch(/50% back/);
    expect(d.hostNote).toBe("");
  });
});

describe("refundDisclaimer host note", () => {
  it("includes the host's note in what the player agrees to", () => {
    const policy = { rule: "none" as const, latePct: 0 };
    expect(refundDisclaimer(policy, 60, "Rain-outs refunded.")).toContain(
      "Host's note: Rain-outs refunded.",
    );
    expect(refundDisclaimer(policy, 60)).not.toContain("Host's note");
  });
});

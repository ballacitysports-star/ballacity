import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gamePolicyLines, gamePolicyTeaser, viewerGamePolicy } from "@/lib/game-policy";

/**
 * P0-7: "Before you join" on the game page must agree with the join button and
 * the payment terms. A visitor or a player who has not asked to join cannot read
 * the host's settings row, so both read public sources: get_game_join_policy for
 * approval and get_game_refund_terms for refunds. The policy block now does too.
 */

const freeGame = { maxPlayers: 10, price: 0, cancelCutoffMin: 120 };
const paidGame = { maxPlayers: 10, price: 15, cancelCutoffMin: 120 };

const line = (policy: ReturnType<typeof viewerGamePolicy>, id: string) =>
  gamePolicyLines(policy).find((l) => l.id === id)?.value ?? "";

describe("viewerGamePolicy for someone who cannot read the settings row", () => {
  it("shows an instant-join game as instant join, like the button", () => {
    const policy = viewerGamePolicy({
      game: freeGame,
      settings: null,
      requiresApproval: false,
      refundTerms: null,
    });
    expect(gamePolicyTeaser(policy)).toContain("Instant join");
    expect(line(policy, "approval")).toMatch(/first come, first served/);
  });

  it("keeps approval while the public policy is unknown, as the button does", () => {
    const policy = viewerGamePolicy({
      game: freeGame,
      settings: null,
      requiresApproval: null,
      refundTerms: null,
    });
    expect(gamePolicyTeaser(policy)).toContain("Host approval");
  });

  it("states the host's real refund rule from the public terms", () => {
    const policy = viewerGamePolicy({
      game: paidGame,
      settings: null,
      requiresApproval: true,
      refundTerms: { refund_rule: "none", late_refund_pct: 0, refund_policy: "Cash only." },
    });
    expect(line(policy, "refund")).toMatch(/non-refundable/);
    expect(line(policy, "refund")).toContain("Cash only.");
    expect(line(policy, "payment")).toContain("$15");
  });
});

describe("viewerGamePolicy with the settings row readable", () => {
  it("reads approval, fee and refunds from the row, as before", () => {
    const policy = viewerGamePolicy({
      game: paidGame,
      settings: { entry_fee: 20 },
      requiresApproval: true,
      refundTerms: { refund_rule: "before_start", late_refund_pct: 50, refund_policy: null },
    });
    expect(policy.entryFee).toBe(20);
    expect(policy.requiresApproval).toBe(true);
    expect(policy.refundRule).toBe("before_start");
    expect(policy.lateRefundPct).toBe(50);
  });
});

describe("game page", () => {
  it("builds 'Before you join' from the button's join policy and the loaded refund terms", () => {
    const route = readFileSync("src/routes/games.$gameId.index.tsx", "utf8");
    const start = route.indexOf("const viewerPolicy = useMemo<GamePolicy>(");
    const block = route.slice(start, route.indexOf(");", start));
    expect(start).toBeGreaterThan(0);
    expect(block).toContain("requiresApproval: publicRequiresApproval");
    expect(block).toContain("refundTerms,");
    expect(block).not.toContain("settings ? !!settings.requires_approval : true");
    // The join button decides with the same value.
    expect(route).toContain("const hostRequiresApproval = publicRequiresApproval ?? true;");
  });
});

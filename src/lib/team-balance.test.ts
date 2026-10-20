import { describe, expect, it } from "vitest";
import { balanceTeams, playerStrength, type BalancePlayer } from "@/lib/team-balance";
import { SKILL } from "@/lib/skill-rating";

const ps = (...mus: number[]): BalancePlayer[] => mus.map((mu, i) => ({ id: `p${i}`, mu }));
const ids = (r: ReturnType<typeof balanceTeams>) =>
  r.teams.map((t) => t.players.map((p) => p.id).sort());

describe("balanceTeams", () => {
  it("keeps every player exactly once and sizes within one", () => {
    const players = ps(80, 72, 65, 60, 55, 50, 42);
    const r = balanceTeams(players, 2);
    const all = r.teams.flatMap((t) => t.players.map((p) => p.id)).sort();
    expect(all).toEqual(players.map((p) => p.id).sort());
    const sizes = r.teams.map((t) => t.players.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("splits a strong pair rather than stacking them", () => {
    const r = balanceTeams(ps(90, 88, 40, 38), 2);
    for (const t of r.teams) {
      expect(t.players.some((p) => p.mu >= 88)).toBe(true);
    }
    expect(r.quality).toBe("even");
  });

  it("finds a near-perfect split when one exists", () => {
    // {70,40,30,20} vs {60,50,35,15}: averages 40 vs 40
    const r = balanceTeams(ps(70, 60, 50, 40, 35, 30, 20, 15), 2);
    expect(r.gap).toBeLessThanOrEqual(1);
  });

  it("supports more than two teams", () => {
    const r = balanceTeams(ps(90, 80, 70, 60, 50, 40, 30, 20, 10), 3);
    expect(r.teams).toHaveLength(3);
    expect(r.teams.every((t) => t.players.length === 3)).toBe(true);
    expect(r.gap).toBeLessThanOrEqual(5);
  });

  it("reports an uneven split when no fair one exists", () => {
    const r = balanceTeams(ps(100, 10), 2);
    expect(r.quality).toBe("uneven");
  });

  it("is deterministic per seed and a new seed can reorder ties", () => {
    const tied = ps(50, 50, 50, 50, 50, 50);
    expect(ids(balanceTeams(tied, 2, 7))).toEqual(ids(balanceTeams(tied, 2, 7)));
    const variants = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((s) => JSON.stringify(ids(balanceTeams(tied, 2, s)))),
    );
    expect(variants.size).toBeGreaterThan(1);
  });

  it("handles empty and tiny rosters", () => {
    expect(balanceTeams([], 2).teams.flatMap((t) => t.players)).toHaveLength(0);
    expect(balanceTeams(ps(60), 2).teams).toHaveLength(1);
  });
});

describe("playerStrength", () => {
  it("prefers a stored rating, then the self level, then the prior", () => {
    expect(playerStrength({ ratingMu: 71, selfScore: 30 })).toEqual({ mu: 71, source: "rating" });
    const self = playerStrength({ selfScore: 80 });
    expect(self.source).toBe("self");
    expect(self.mu).toBeGreaterThan(SKILL.priorMean);
    expect(self.mu).toBeLessThan(80); // a self rating alone is shrunk toward the prior
    expect(playerStrength({})).toEqual({ mu: SKILL.priorMean, source: "none" });
  });
});

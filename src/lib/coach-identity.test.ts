import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COACHING_ROLES, coachedTeamsFrom, isCoachingRole } from "./coach-identity";

const team = (id: string, name: string, hidden_at: string | null = null) => ({
  id,
  name,
  handle: id,
  hidden_at,
});

describe("coach identity (P2-2)", () => {
  it("counts the same roles as the database sync: owner, manager, coach", () => {
    expect([...COACHING_ROLES]).toEqual(["owner", "manager", "coach"]);
    const sql = readFileSync("supabase/migrations/20261106190000_coach_identity.sql", "utf8");
    expect(sql).toContain("tm.role IN ('owner', 'manager', 'coach')");
    expect(isCoachingRole("captain")).toBe(false);
    expect(isCoachingRole("player")).toBe(false);
  });

  it("lists coached teams, owner first then by name, without hidden teams or other roles", () => {
    const out = coachedTeamsFrom([
      { role: "coach", teams: team("z", "Zebras") },
      { role: "coach", teams: team("a", "Ants") },
      { role: "owner", teams: team("o", "Owls") },
      { role: "player", teams: team("p", "Pumas") },
      { role: "captain", teams: team("c", "Cats") },
      { role: "manager", teams: team("h", "Hidden", "2026-11-01T00:00:00Z") },
      { role: "manager", teams: null },
    ]);
    expect(out.map((t) => [t.name, t.role])).toEqual([
      ["Owls", "owner"],
      ["Ants", "coach"],
      ["Zebras", "coach"],
    ]);
  });

  it("the switcher shows Coach only when there is a coached team, and never in a child profile", () => {
    const src = readFileSync("src/components/ProfileSwitcher.tsx", "utf8");
    expect(src).toContain("useCoachedTeams(!inChildProfile)");
    expect(src).toContain("{!inChildProfile && coachedCount > 0 ? (");
    expect(src).toContain('<Link to="/coach">');
  });

  it("the Teams you coach page requires sign-in and is not indexed", () => {
    const src = readFileSync("src/routes/coach.tsx", "utf8");
    expect(src).toContain("withRequireAuth(CoachHome)");
    expect(src).toContain("noindex: true");
  });
});

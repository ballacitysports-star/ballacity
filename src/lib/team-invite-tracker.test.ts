import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inviteGuardianColumns } from "./team-invite-tracker";

describe("invite tracker guardian columns (review finding F2)", () => {
  it("an adult, a minor and a blocked invitee look the same until a guardian approves", () => {
    const pending = { guardian_approved_at: null };
    expect(inviteGuardianColumns(pending)).toEqual({
      needsGuardian: false,
      guardianApproved: false,
    });
  });

  it("shows a guardian's approval, which the guardian disclosed to the team", () => {
    expect(inviteGuardianColumns({ guardian_approved_at: "2026-11-04T10:00:00Z" })).toEqual({
      needsGuardian: true,
      guardianApproved: true,
    });
  });

  it("getTeamInviteTracker never reads guardian_links for invitees", () => {
    const src = readFileSync(new URL("./tryouts.functions.ts", import.meta.url), "utf8");
    const start = src.indexOf("export const getTeamInviteTracker");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\nexport const ", start + 1);
    const body = src.slice(start, end === -1 ? undefined : end);
    expect(body).not.toMatch(/guardian_links/);
    expect(body).toMatch(/inviteGuardianColumns\(/);
  });
});

import { describe, expect, it } from "vitest";
import {
  NO_STAFF_ACCESS,
  showsStaffChrome,
  staffDashboards,
  staffHomeFor,
  staffTierOf,
} from "@/lib/staff";

const sa = { isSuperadmin: true, isAdmin: true, isModerator: true };
const admin = { isSuperadmin: false, isAdmin: true, isModerator: true };
const mod = { isSuperadmin: false, isAdmin: false, isModerator: true };

describe("staff dispatcher", () => {
  it("sends each tier to its own dashboard", () => {
    expect(staffHomeFor(sa)).toBe("/superadmin");
    expect(staffHomeFor(admin)).toBe("/admin");
    expect(staffHomeFor(mod)).toBe("/admin/moderation");
    expect(staffHomeFor(NO_STAFF_ACCESS)).toBeNull();
  });

  it("reports the highest tier", () => {
    expect(staffTierOf(sa)).toBe("superadmin");
    expect(staffTierOf(admin)).toBe("admin");
    expect(staffTierOf(mod)).toBe("moderator");
    expect(staffTierOf(NO_STAFF_ACCESS)).toBeNull();
  });

  it("lists lower-tier dashboards for higher tiers only", () => {
    expect(staffDashboards(sa).map((d) => d.tier)).toEqual(["superadmin", "admin", "moderator"]);
    expect(staffDashboards(admin).map((d) => d.tier)).toEqual(["admin", "moderator"]);
    expect(staffDashboards(mod).map((d) => d.tier)).toEqual(["moderator"]);
    expect(staffDashboards(NO_STAFF_ACCESS)).toEqual([]);
  });

  it("shows the badge and switcher for admins and superadmins only", () => {
    expect(showsStaffChrome(sa)).toBe(true);
    expect(showsStaffChrome(admin)).toBe(true);
    expect(showsStaffChrome(mod)).toBe(false);
    expect(showsStaffChrome(NO_STAFF_ACCESS)).toBe(false);
  });
});

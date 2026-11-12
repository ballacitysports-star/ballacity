import { describe, expect, it } from "vitest";
import { orgMemberAddErrorMessage } from "@/lib/org-members";

describe("orgMemberAddErrorMessage", () => {
  it("turns the database's refusal of a direct add into a next step (20261111120000)", () => {
    const msg = orgMemberAddErrorMessage(
      'new row violates row-level security policy for table "org_members"',
    );
    expect(msg).toMatch(/can't be added directly/);
    expect(msg).toMatch(/request to join/);
    expect(msg).not.toMatch(/row-level security|org_members/);
  });

  it("does not say why, so it reveals nothing about the person's age", () => {
    const msg = orgMemberAddErrorMessage(
      'new row violates row-level security policy for table "org_members"',
    );
    expect(msg).not.toMatch(/\b(age|birth|birthday|minor|adult|under 18)\b/i);
  });

  it("passes any other error through unchanged", () => {
    expect(orgMemberAddErrorMessage("network down")).toBe("network down");
  });
});

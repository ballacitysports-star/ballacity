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

  it("never passes other database text through (WP 4.0)", () => {
    expect(
      orgMemberAddErrorMessage('insert or update on table "org_members" violates foreign key'),
    ).toBe("Couldn't add this member. Please try again.");
    expect(orgMemberAddErrorMessage("FORBIDDEN: not an admin")).toBe(
      "You don't have access to that.",
    );
    expect(orgMemberAddErrorMessage("TypeError: Failed to fetch")).toBe(
      "We couldn't connect. Check your internet connection and try again.",
    );
  });
});

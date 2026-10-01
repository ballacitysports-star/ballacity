import { describe, expect, it } from "vitest";
import { addableProfileKinds, addProfileRoute, type AccountProfile } from "@/lib/account-profiles";

/**
 * Pure helpers for multi-profile switching. Fetching/switching themselves
 * need Supabase and React Query, so are exercised through e2e instead.
 */

function profile(kind: AccountProfile["kind"]): AccountProfile {
  return {
    id: `id-${kind}`,
    kind,
    refId: null,
    name: kind,
    handle: null,
    avatarUrl: null,
    avatarFallback: "?",
    href: { to: "/profile" },
  };
}

describe("addableProfileKinds", () => {
  it("offers team, trainer and gym regardless of how many the account already has", () => {
    const kinds = addableProfileKinds([profile("player"), profile("team"), profile("team")]);
    expect(kinds).toEqual(expect.arrayContaining(["team", "trainer", "gym"]));
  });

  it("offers parent only while the account doesn't already have one", () => {
    expect(addableProfileKinds([profile("player")])).toContain("parent");
    expect(addableProfileKinds([profile("player"), profile("parent")])).not.toContain("parent");
  });

  it("never offers player — every account already has one", () => {
    expect(addableProfileKinds([profile("parent")])).not.toContain("player");
    expect(addableProfileKinds([])).not.toContain("player");
  });

  it("puts parent first when offered, ahead of the repeatable kinds", () => {
    expect(addableProfileKinds([profile("player")])).toEqual(["parent", "team", "trainer", "gym"]);
  });
});

describe("addProfileRoute", () => {
  it("routes team, trainer and gym to their create screens", () => {
    expect(addProfileRoute("team")).toBe("/teams/create");
    expect(addProfileRoute("trainer")).toBe("/trainers/create");
    expect(addProfileRoute("gym")).toBe("/orgs/create");
  });

  it("routes parent to Add your child — there is no separate guardian-creation screen", () => {
    expect(addProfileRoute("parent")).toBe("/players/add");
  });
});

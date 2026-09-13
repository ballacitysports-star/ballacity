import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { completionFor, initialsFor, type PlayerProfile } from "@/lib/player-profiles";
import { destinationForSetupChoice } from "@/routes/onboarding.setup-for";
import { destinationForAccountType } from "@/components/onboarding/AccountTypeScreen";

/**
 * Stage 2: adding a player, and the onboarding fork that leads to it.
 *
 * The behaviour that matters here cannot be asserted from the client at all —
 * that a child row carries no auth account, and that their age cohort is
 * derived rather than chosen — because both are enforced in the database.
 * Those were verified against production directly. What these cover is the
 * part that lives in this repo: that the form never sends the columns the
 * grants forbid, and that the routing fork exists.
 */

const addPlayer = readFileSync(new URL("../routes/players.add.tsx", import.meta.url), "utf8");
const lib = readFileSync(new URL("./player-profiles.ts", import.meta.url), "utf8");

describe("adding a child does not create a login", () => {
  it("leaves user_id null for anyone but the account owner", () => {
    // The whole refactor in one expression. If this ever became `me` for a
    // child, every child would silently need an auth account again.
    expect(lib).toMatch(/user_id:\s*input\.isSelf\s*\?\s*me\s*:\s*null/);
  });

  it("never sends the derived cohort", () => {
    // age_cohort is absent from the INSERT grant, so naming it does not get
    // overwritten — it fails the whole statement with 42501.
    const insert = /\.insert\(\{[\s\S]*?\}\)/.exec(lib);
    expect(insert).not.toBeNull();
    expect(insert![0]).not.toMatch(/age_cohort/);
  });

  it("never sends ownership columns it is not allowed to change", () => {
    // account_id is grantable on INSERT (you create your own) but the form
    // must always send the signed-in user, never a value from the page.
    expect(lib).toMatch(/account_id:\s*me\b/);
  });

  it("asks for four fields and no more", () => {
    // §4/§20: first name, last name, birthday, sport. Anything else here and
    // onboarding starts becoming a sports resume.
    const ids = [...addPlayer.matchAll(/<(?:Input|select)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.sort()).toEqual(["dob", "first-name", "last-name", "sport"]);
  });

  it("requires only a name and a birthday to submit", () => {
    // A sport the parent does not know yet must not block creating the player.
    expect(addPlayer).toMatch(/canSubmit =[^;]*firstName\.trim\(\) !== ""[^;]*dob !== ""/);
    expect(addPlayer).not.toMatch(/canSubmit =[^;]*sport !== ""/);
  });

  it("shows a real explanation rather than a database error", () => {
    // §23: a raw PostgREST error must never reach the screen.
    expect(addPlayer).toMatch(/instanceof PlayerProfileError/);
    expect(lib).toMatch(/case "42501":/);
    expect(lib).toMatch(/case "23514":/);
  });
});

describe("the onboarding fork", () => {
  it("asks who the account is for before the profile wizard", () => {
    // The wizard asks about one athlete; reaching it first would assume that
    // athlete is the account owner.
    expect(destinationForAccountType("player")).toBe("/onboarding/setup-for");
  });

  it("sends a parent setting up for a child straight to Add Player", () => {
    expect(destinationForSetupChoice("child")).toBe("/players/add");
  });

  it("sends an adult player, and 'both', to their own profile first", () => {
    expect(destinationForSetupChoice("me")).toBe("/onboarding/welcome");
    expect(destinationForSetupChoice("both")).toBe("/onboarding/welcome");
  });

  it("leaves the other account types where they were", () => {
    // Stage 2 must not reroute teams, trainers or gyms.
    expect(destinationForAccountType("team")).toBe("/teams/create");
    expect(destinationForAccountType("trainer")).toBe("/trainers/create");
    expect(destinationForAccountType("gym")).toBe("/orgs/create");
  });
});

describe("progressive completion (§5)", () => {
  const p: PlayerProfile = {
    id: "p1",
    accountId: "a1",
    userId: null,
    displayName: "Jake Smith",
    slug: null,
    dateOfBirth: "2013-06-04",
    ageCohort: "teen_13_15",
    avatarInitials: "JS",
    avatarUrl: null,
    bio: null,
    location: null,
    primarySport: "Baseball",
    legacy: false,
  };

  it("reports what is left rather than blocking", () => {
    const { pct, missing } = completionFor(p);
    expect(missing).toContain("Profile photo");
    expect(missing).toContain("Bio");
    expect(missing).not.toContain("Sport");
    expect(pct).toBe(40);
  });

  it("reaches 100 only when every area is filled", () => {
    const full = { ...p, avatarUrl: "u", bio: "b", location: "Brooklyn" };
    expect(completionFor(full).pct).toBe(100);
    expect(completionFor(full).missing).toEqual([]);
  });

  it("builds initials from whatever name it has", () => {
    expect(initialsFor("Jake", "Smith")).toBe("JS");
    expect(initialsFor("Jake", "")).toBe("JA");
    expect(initialsFor("", "")).toBe("PL");
  });
});

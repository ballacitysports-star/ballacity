import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { destinationForSetupChoice } from "@/routes/onboarding.setup-for";
import { destinationForManageChoice } from "@/routes/onboarding.manage";
import {
  destinationForAccountType,
  destinationForStartingPoint,
} from "@/components/onboarding/AccountTypeScreen";
import { MANAGER_ROUTE } from "@/lib/age-verification";

/**
 * Adding a child, and the onboarding fork that leads to it.
 *
 * A child added by a parent is a real auth user with no credentials (a
 * "managed child"), so every child-safety control that keys on the child's
 * auth id applies to them. The database side — adult check, ownership,
 * birthday lock, consent, controls — is covered by managed-children.test.ts
 * and was verified by replaying the migration chain; these cover the part that
 * lives in the app: what the server function sends and what the form asks.
 */

const addChild = readFileSync(new URL("../routes/players.add.tsx", import.meta.url), "utf8");
const fns = readFileSync(new URL("./managed-children.functions.ts", import.meta.url), "utf8");

describe("adding a child creates no credentials", () => {
  const createUser = /auth\.admin\.createUser\(\{[\s\S]*?\}\)/.exec(fns);

  it("creates the child through the Admin API with no password", () => {
    expect(createUser).not.toBeNull();
    expect(createUser![0]).not.toMatch(/password/);
    expect(createUser![0]).toMatch(/email:\s*managedEmailFor\(/);
    expect(createUser![0]).toMatch(/email_confirm:\s*true/);
  });

  it("marks the child as managed by the caller in app_metadata, never from the request", () => {
    // app_metadata is service-role-only; provision_managed_child() trusts it.
    expect(createUser![0]).toMatch(
      /app_metadata:\s*\{\s*managed:\s*true,\s*managed_by:\s*ctx\.userId\s*\}/,
    );
  });

  it("provisions with the guardian's own token so the database sees the guardian", () => {
    expect(fns).toMatch(/ctx\.supabase\.rpc\(\s*"provision_managed_child"/);
    expect(fns).not.toMatch(/supabaseAdmin\.rpc\(\s*"provision_managed_child"/);
  });

  it("removes the auth user again when provisioning fails", () => {
    const branch = /if \(provisionError\) \{[\s\S]*?\n {4}\}/.exec(fns);
    expect(branch).not.toBeNull();
    expect(branch![0]).toMatch(/auth\.admin\.deleteUser\(childUserId\)/);
  });

  it("refuses to run from a managed child's own session", () => {
    expect(fns).toMatch(/refuseManagedCaller\(ctx\);[\s\S]*?createUser/);
  });
});

describe("the Add your child form", () => {
  it("asks for five fields and no more", () => {
    // First name, last name (initial only), birthday, sport, relationship.
    // Anything else here and onboarding starts becoming a sports résumé.
    const ids = [...addChild.matchAll(/<(?:Input|select)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.sort()).toEqual(["dob", "first-name", "last-name", "relationship", "sport"]);
  });

  it("requires a name, a birthday and the guardian's attestation — not a sport", () => {
    const rule = /canSubmit =[^;]*;/.exec(addChild)![0];
    expect(rule).toMatch(/firstName\.trim\(\) !== ""/);
    expect(rule).toMatch(/dob !== ""/);
    expect(rule).toMatch(/attested/);
    expect(rule).not.toMatch(/sport/);
  });

  it("shows the server's parent-facing message rather than a database error", () => {
    // §23: the server maps every failure through managedChildErrorMessage().
    expect(fns).toMatch(/managedChildErrorMessage\(provisionError\.message\)/);
    expect(addChild).toMatch(/toast\.error\(\s*e instanceof Error \? e\.message/);
  });
});

describe("the onboarding fork", () => {
  it("asks who the account is for before the profile wizard", () => {
    // The wizard asks about one athlete; reaching it first would assume that
    // athlete is the account owner.
    expect(destinationForAccountType("player")).toBe("/onboarding/setup-for");
  });

  it("sends a parent setting up for a child straight to Add your child", () => {
    expect(destinationForSetupChoice("child")).toBe("/players/add");
  });

  it("sends an adult player, and 'both', to their own profile first", () => {
    expect(destinationForSetupChoice("me")).toBe("/onboarding/welcome");
    expect(destinationForSetupChoice("both")).toBe("/onboarding/welcome");
  });

  it("continues 'both' into Add your child after the owner's own profile", () => {
    const welcome = readFileSync(
      new URL("../routes/onboarding.welcome.tsx", import.meta.url),
      "utf8",
    );
    expect(welcome).toMatch(/addChildNext: z\.boolean\(\)\.optional\(\)/);
    expect(welcome).toMatch(/addChildNext\) nav\(\{ to: "\/players\/add"/);
  });

  it("leaves the other account types where they were", () => {
    expect(destinationForAccountType("team")).toBe("/teams/create");
    expect(destinationForAccountType("trainer")).toBe("/trainers/create");
    expect(destinationForAccountType("gym")).toBe("/orgs/create");
  });
});

describe("the Parent / Guardian / Owner fork", () => {
  it("sends the new top-level choice to 'what will you manage?', not the player fork", () => {
    // Stored as a player, but they have already said who they are: asking "who
    // is this for?" as well would be the same question twice.
    expect(destinationForStartingPoint("manager")).toBe(MANAGER_ROUTE);
    expect(MANAGER_ROUTE).toBe("/onboarding/manage");
  });

  it("leaves every real account type going where it went before", () => {
    for (const t of ["player", "team", "trainer", "gym"] as const) {
      expect(destinationForStartingPoint(t)).toBe(destinationForAccountType(t));
    }
  });

  it("sends each thing they can manage to the flow that creates it", () => {
    expect(destinationForManageChoice("child")).toBe("/players/add");
    expect(destinationForManageChoice("team")).toBe("/teams/create");
    expect(destinationForManageChoice("gym")).toBe("/orgs/create");
  });

  it("opens Add your child with the onboarding wording when the child is chosen", () => {
    const manage = readFileSync(
      new URL("../routes/onboarding.manage.tsx", import.meta.url),
      "utf8",
    );
    expect(manage).toMatch(/choice === "child" \? \{ from: "onboarding" \} : undefined/);
  });
});

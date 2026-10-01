import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hrefForSetup, SETUPS } from "@/lib/account-type";

/**
 * Adding a child, and the one role selection that leads to it.
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

describe("a parent or guardian goes straight to Add your child", () => {
  it("is one selection: Parent / Guardian leads to Add your child, stored as a player", () => {
    // No "who is this for?" and no athlete questions in between.
    expect(hrefForSetup("child")).toBe("/players/add?from=onboarding");
    expect(SETUPS.child.accountType).toBe("parent");
  });

  it("opens Add your child with the onboarding wording", () => {
    expect(addChild).toMatch(/from === "onboarding"\s*\?\s*"Set up the player you're managing/);
  });

  it("offers a way on to the Parent Center without adding a child", () => {
    expect(addChild).toMatch(
      /from === "onboarding" \?[\s\S]{0,400}to="\/parent"[\s\S]{0,200}Skip for now/,
    );
  });

  it("leaves the welcome wizard for players alone, with nothing leading back to a fork", () => {
    const welcome = readFileSync(
      new URL("../routes/onboarding.welcome.tsx", import.meta.url),
      "utf8",
    );
    expect(welcome).not.toMatch(/addChildNext|setup-for/);
    expect(hrefForSetup("player")).toBe("/onboarding/welcome");
  });
});

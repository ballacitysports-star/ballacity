import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PARKED_GUARDIAN_KEY,
  isIdentitySwitchInProgress,
  readParkedGuardianSession,
} from "@/lib/managed-session";
import { PER_USER_STORAGE_KEYS } from "@/lib/per-user-state";

/**
 * Guardian ⇄ managed-child switching.
 *
 * The switch itself needs a browser and a live backend (covered by
 * e2e/managed-child.spec.ts). These pin the orderings that make it safe, which
 * a later edit could quietly break without any test noticing.
 */

const session = readFileSync(new URL("./managed-session.ts", import.meta.url), "utf8");
const watcher = readFileSync(new URL("../hooks/use-managed-session.ts", import.meta.url), "utf8");
const auth = readFileSync(new URL("../hooks/use-auth.ts", import.meta.url), "utf8");

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("the parked guardian session", () => {
  it("is stored under a key that does not look like a live Supabase session", () => {
    // authgate-log and the e2e cleanup find the live session by this pattern;
    // matching it would make them read the guardian while the child is active.
    expect(PARKED_GUARDIAN_KEY).not.toMatch(/^sb-.*-auth-token$/);
  });

  it("reads as absent outside a browser, and no switch is in progress", () => {
    expect(readParkedGuardianSession()).toBeNull();
    expect(isIdentitySwitchInProgress()).toBe(false);
  });
});

describe("switching into a child", () => {
  const body = fnBody(session, "switchToManagedChild");

  it("stops token refresh before parking, and parks before becoming the child", () => {
    // A refresh between the snapshot and the swap would rotate the guardian's
    // refresh token and leave a used one parked.
    const stop = body.indexOf("stopAutoRefresh()");
    const park = body.indexOf("writeParked(");
    const become = body.indexOf("verifyOtp(");
    expect(stop).toBeGreaterThan(0);
    expect(park).toBeGreaterThan(stop);
    expect(become).toBeGreaterThan(park);
  });

  it("ends in a full page load, never an in-app navigation", () => {
    expect(body).toMatch(/window\.location\.assign\(/);
  });
});

describe("switching back and signing out", () => {
  it("takes the parked session off the device before signing the child out", () => {
    const body = fnBody(session, "switchBackToGuardian");
    expect(body.indexOf("takeParkedGuardianSession()")).toBeLessThan(body.indexOf("signOut("));
  });

  it("ends both sessions on sign-out", () => {
    const body = auth.slice(auth.indexOf("export async function signOut()"));
    const take = body.indexOf("takeParkedGuardianSession()");
    const out = body.indexOf('supabase.auth.signOut({ scope: "local" })');
    const revoke = body.indexOf("revokeParkedGuardianSession(parked)");
    expect(take).toBeGreaterThan(0);
    expect(out).toBeGreaterThan(take);
    expect(revoke).toBeGreaterThan(out);
  });

  it("does not reload the tab that is itself switching", () => {
    expect(watcher).toMatch(/previous !== id && !isIdentitySwitchInProgress\(\)/);
  });
});

describe("per-user client state", () => {
  it("clears cached per-account lists and pending signup answers", () => {
    expect(PER_USER_STORAGE_KEYS).toEqual(
      expect.arrayContaining([
        "openrun.joinedGameIds.v1",
        "openrun.hostedGames.v1",
        "openrun:pending-dob",
        "openrun:pending-legal-consent",
      ]),
    );
  });

  it("keeps a host's block list, which is keyed by host and exists nowhere else", () => {
    expect(PER_USER_STORAGE_KEYS).not.toContain("openrun.blockedUsers.v1");
  });
});

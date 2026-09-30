import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPES,
  START_AS_KEY,
  canStartAsManager,
  hasManagerHint,
  isStartingPoint,
} from "@/lib/account-type";

/**
 * "Parent / Guardian / Owner" at sign-up and in onboarding.
 *
 * It is a starting point, not an account type: the account is stored as a
 * player and, for email sign-ups, carries a hint in its sign-up metadata so the
 * choice survives email confirmation on another device. The pure pieces are
 * tested directly; the wiring through the sign-up form, the landing routes and
 * the root gate is pinned from source, since rendering those pulls in the
 * router, Supabase and realtime.
 */

// Source assertions must not be satisfied by a commented-out line.
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const read = (rel: string) => stripComments(readFileSync(new URL(rel, import.meta.url), "utf8"));

describe("starting points", () => {
  it("are the four account types plus manager, and nothing else", () => {
    for (const t of ACCOUNT_TYPES) expect(isStartingPoint(t)).toBe(true);
    expect(isStartingPoint("manager")).toBe(true);
    expect(isStartingPoint("guardian")).toBe(false);
    expect(isStartingPoint("")).toBe(false);
    expect(isStartingPoint(null)).toBe(false);
  });
});

describe("the manager hint", () => {
  it("is present only when sign-up stored exactly 'manager'", () => {
    expect(hasManagerHint({ user_metadata: { [START_AS_KEY]: "manager" } })).toBe(true);
    expect(hasManagerHint({ user_metadata: { [START_AS_KEY]: "player" } })).toBe(false);
    expect(hasManagerHint({ user_metadata: { [START_AS_KEY]: true } })).toBe(false);
    expect(hasManagerHint({ user_metadata: { [START_AS_KEY]: null } })).toBe(false);
    expect(hasManagerHint({ user_metadata: {} })).toBe(false);
    expect(hasManagerHint({ user_metadata: null })).toBe(false);
    expect(hasManagerHint({})).toBe(false);
    expect(hasManagerHint(null)).toBe(false);
    expect(hasManagerHint(undefined)).toBe(false);
  });
});

describe("who may start as a manager", () => {
  it("is adults only, because a child, a team and a gym all need one", () => {
    expect(canStartAsManager("adult")).toBe(true);
    for (const cohort of [
      "teen_16_17",
      "teen_13_15",
      "child_under_13",
      "unknown",
      "",
      null,
      undefined,
    ]) {
      expect(canStartAsManager(cohort)).toBe(false);
    }
  });
});

describe("the sign-up form", () => {
  const auth = read("../routes/auth.tsx");

  it("stores a manager as a player and adds the hint only for a manager", () => {
    expect(auth).toMatch(
      /const accountType = startingPoint \? accountTypeForStartingPoint\(startingPoint\) : null/,
    );
    expect(auth).toMatch(/account_type: accountType,/);
    expect(auth).toMatch(
      /\.\.\.\(startingPoint === "manager" \? \{ \[START_AS_KEY\]: "manager" \} : \{\}\)/,
    );
  });

  it("refuses a manager whose birth date is not an adult's, after the date itself is checked", () => {
    const dobCheck = auth.search(/const dobCheck = checkDobParts\(dob\)/);
    const adult = auth.search(
      /startingPoint === "manager" && !canStartAsManager\(dobCheck\.cohort\)/,
    );
    const signUp = auth.search(/supabase\.auth\.signUp\(/);
    expect(dobCheck).toBeGreaterThan(0);
    expect(adult).toBeGreaterThan(dobCheck);
    expect(signUp).toBeGreaterThan(adult);
  });

  it("hands the hint to the post-sign-in destination", () => {
    expect(auth).toMatch(/startAsManager: hasManagerHint\(currentUser\)/);
  });
});

describe("the landing routes and the root gate", () => {
  it("send an email-confirmation landing with the hint to 'what will you manage?'", () => {
    const index = read("../routes/index.tsx");
    expect(index).toMatch(/hasManagerHint\(user\)\s*\?\s*MANAGER_ROUTE/);
  });

  it("send a manager picked in the inline gate to the same screen", () => {
    const root = read("../routes/__root.tsx");
    expect(root).toMatch(/startingPoint === "manager"[\s\S]{0,200}MANAGER_ROUTE/);
  });

  it("are the only readers of the hint: no gate looks at it, so the gates cannot loop on it", () => {
    const root = read("../routes/__root.tsx");
    expect(root).not.toMatch(/hasManagerHint/);
    expect(root).not.toMatch(/START_AS_KEY/);
  });
});

describe("the 'what will you manage?' screen", () => {
  const screen = read("../routes/onboarding.manage.tsx");

  it("clears the hint whatever they choose, including skipping", () => {
    // Every exit goes through leave(), which clears it first.
    expect(screen).toMatch(
      /const leave = \(to: string, search\?: Record<string, unknown>\) => \{\s*[^}]*void clearManagerHint\(\)/,
    );
    expect(screen).toMatch(/onClick=\{\(\) => leave\("\/feed"\)\}/);
  });

  it("sends anyone who is not an adult away rather than onto a dead end", () => {
    expect(screen).toMatch(/!canStartAsManager\(ageStatus\.cohort\)/);
    expect(screen).toMatch(/navigate\(\{ to: "\/feed", replace: true \}\)/);
  });

  it("drops the hint when it sends a non-adult away, so every later landing does not detour here", () => {
    expect(screen).toMatch(
      /!canStartAsManager\(ageStatus\.cohort\)\) \{\s*void clearManagerHint\(\);\s*navigate\(\{ to: "\/feed"/,
    );
  });
});

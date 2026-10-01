import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPES,
  ROLES,
  SETUPS,
  START_AS_KEY,
  accountTypeForSetup,
  canChooseRole,
  hrefForSetup,
  isSetupId,
  roleOfSetup,
  routeForSetup,
  startSetupOf,
  type SetupId,
} from "@/lib/account-type";

/**
 * One role selection at sign-up and in onboarding, straight to that role's setup.
 *
 * A role is not an account type: the account is stored as the nearest of the four
 * types and, for email sign-ups, carries the setup in its sign-up metadata so the
 * choice survives email confirmation on another device. The pure pieces are
 * tested directly; the wiring through the sign-up form, the landing routes and
 * the root gate is pinned from source, since rendering those pulls in the
 * router, Supabase and realtime.
 */

// Source assertions must not be satisfied by a commented-out line.
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const read = (rel: string) => stripComments(readFileSync(new URL(rel, import.meta.url), "utf8"));
const exists = (rel: string) => existsSync(new URL(rel, import.meta.url));

const SETUP_IDS = Object.keys(SETUPS) as SetupId[];

describe("where each role goes", () => {
  // The product's table, not derived from the code under test.
  it.each([
    ["player", "/onboarding/welcome"],
    ["child", "/players/add?from=onboarding"],
    ["team", "/teams/create"],
    ["coach", "/trainers/create"],
    ["facility", "/orgs/create"],
  ] as const)("%s goes straight to %s", (setup, href) => {
    expect(hrefForSetup(setup)).toBe(href);
  });

  it("gives a router target that agrees with the href", () => {
    for (const s of SETUP_IDS) {
      const { to, search } = routeForSetup(s);
      const qs = search ? `?${new URLSearchParams(search).toString()}` : "";
      expect(`${to}${qs}`).toBe(hrefForSetup(s));
    }
  });

  it("has a setup for every role, and a role for every setup", () => {
    expect(ROLES.flatMap((r) => r.setups).sort()).toEqual([...SETUP_IDS].sort());
    for (const s of SETUP_IDS) expect(roleOfSetup(s).setups).toContain(s);
  });

  it("puts two setups behind Team / Coach and one behind each of the others", () => {
    expect(Object.fromEntries(ROLES.map((r) => [r.id, r.setups]))).toEqual({
      player: ["player"],
      parent: ["child"],
      team_coach: ["team", "coach"],
      facility: ["facility"],
    });
  });

  it("stores a parent as a guardian, never as a player", () => {
    expect(accountTypeForSetup("child")).toBe("parent");
    expect(ACCOUNT_TYPES).toEqual(["player", "team", "trainer", "gym", "parent"]);
    for (const s of SETUP_IDS) expect(ACCOUNT_TYPES).toContain(accountTypeForSetup(s));
  });
});

describe("who may choose a role", () => {
  it("is adults only for Parent / Guardian, because a child, a team and a gym all need one", () => {
    expect(canChooseRole("parent", "adult")).toBe(true);
    for (const cohort of [
      "teen_16_17",
      "teen_13_15",
      "child_under_13",
      "unknown",
      "",
      null,
      undefined,
    ]) {
      expect(canChooseRole("parent", cohort)).toBe(false);
    }
  });

  it("puts no new age limit on the other roles", () => {
    for (const role of ["player", "team_coach", "facility"] as const) {
      for (const cohort of ["adult", "teen_16_17", "teen_13_15", "unknown", null, undefined]) {
        expect(canChooseRole(role, cohort)).toBe(true);
      }
    }
  });
});

describe("the setup carried through email confirmation", () => {
  it.each(SETUP_IDS)("reads back %s", (setup) => {
    expect(startSetupOf({ user_metadata: { [START_AS_KEY]: setup } })).toBe(setup);
  });

  it("reads the retired 'manager' value as a parent, so a sign-up made before this shipped still lands right", () => {
    expect(startSetupOf({ user_metadata: { [START_AS_KEY]: "manager" } })).toBe("child");
  });

  it("reads nothing else", () => {
    for (const v of ["guardian", "parent", "team_coach", "", true, 1, {}, [], null, undefined]) {
      expect(startSetupOf({ user_metadata: { [START_AS_KEY]: v } })).toBeNull();
    }
    expect(startSetupOf({ user_metadata: {} })).toBeNull();
    expect(startSetupOf({ user_metadata: null })).toBeNull();
    expect(startSetupOf({})).toBeNull();
    expect(startSetupOf(null)).toBeNull();
    expect(startSetupOf(undefined)).toBeNull();
  });

  it("does not mistake an object prototype key for a setup", () => {
    for (const v of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(isSetupId(v)).toBe(false);
      expect(startSetupOf({ user_metadata: { [START_AS_KEY]: v } })).toBeNull();
    }
  });
});

describe("the sign-up form", () => {
  const auth = read("../routes/auth.tsx");

  it("stores the setup's account type and adds the setup hint, but not for a guardian on a consent link", () => {
    expect(auth).toMatch(/const accountType = setup \? accountTypeForSetup\(setup\) : null/);
    expect(auth).toMatch(/account_type: accountType,/);
    expect(auth).toMatch(/\.\.\.\(isGuardianEntry \? \{\} : \{ \[START_AS_KEY\]: setup \}\)/);
  });

  it("refuses Parent / Guardian for a birth date that is not an adult's, after the date itself is checked", () => {
    const dobCheck = auth.search(/const dobCheck = checkDobParts\(dob\)/);
    const adult = auth.search(/!canChooseRole\(role\.id, dobCheck\.cohort\)/);
    const signUp = auth.search(/supabase\.auth\.signUp\(/);
    expect(dobCheck).toBeGreaterThan(0);
    expect(adult).toBeGreaterThan(dobCheck);
    expect(signUp).toBeGreaterThan(adult);
  });

  it("hands the setup to the post-sign-in destination, and forgets the hint only once it has used it", () => {
    expect(auth).toMatch(/const startSetup = startSetupOf\(currentUser\)/);
    expect(auth).toMatch(/startDestination,/);
    expect(auth).toMatch(
      /await withTimeout\(clearStartHint\(\), 2000, undefined\);\s*\}\s*leave\(dest\)/,
    );
  });

  it("asks one question, with the role picker, and nothing after it", () => {
    expect(auth).toMatch(/<RolePicker value=\{setup\} onChange=\{setSetup\} \/>/);
    expect(auth).not.toMatch(/setup-for|onboarding\/manage/);
  });
});

describe("the landing routes and the root gate", () => {
  it("send an email-confirmation landing with a setup straight to that setup, once", () => {
    const index = read("../routes/index.tsx");
    expect(index).toMatch(/const setup = startSetupOf\(user\)/);
    expect(index).toMatch(
      /if \(setup\) \{\s*startedSetup\.current = true;\s*void clearStartHint\(\);\s*router\.navigate\(\{ \.\.\.routeForSetup\(setup\), replace: true \} as never\);\s*return;\s*\}/,
    );
  });

  it("send whoever picked in the inline gate to their setup, Player included", () => {
    const root = read("../routes/__root.tsx");
    expect(root).toMatch(
      /const finishType = \(_type\?: AccountType, setup\?: SetupId\) => \{[\s\S]{0,200}if \(setup\) router\.navigate\(\{ \.\.\.routeForSetup\(setup\), replace: true \} as never\)/,
    );
  });

  it("send whoever picked on the standalone screen to their setup with a full-page load", () => {
    const screen = read("../components/onboarding/AccountTypeScreen.tsx");
    expect(screen).toMatch(/window\.location\.replace\(hrefForSetup\(choice\)\)/);
    expect(screen).toMatch(/onResolved\(type, choice\)/);
  });

  it("are the only readers of the hint: no gate looks at it, so the gates cannot loop on it", () => {
    const root = read("../routes/__root.tsx");
    expect(root).not.toMatch(/startSetupOf/);
    expect(root).not.toMatch(/START_AS_KEY/);
  });

  it("offers Parent / Guardian to adults only when picking after sign-up", () => {
    const screen = read("../components/onboarding/AccountTypeScreen.tsx");
    expect(screen).toMatch(/useMyAgeStatus\(!!user\)/);
    expect(screen).toMatch(/const allowParent = canChooseRole\("parent", ageStatus\?\.cohort\)/);
    expect(screen).toMatch(/allowParent=\{allowParent\}/);
  });

  it("waits for that answer before showing any cards, so they do not reflow when it arrives", () => {
    const screen = read("../components/onboarding/AccountTypeScreen.tsx");
    expect(screen).toMatch(/isPending: agePending/);
    expect(screen).toMatch(
      /if \(loading \|\| !user \|\| !checked \|\| \(agePending && !ageWaitOver\)\) \{/,
    );
    // ...but only for a moment: a stalled request must not hold the picker back.
    expect(screen).toMatch(/setTimeout\(\(\) => setAgeWaitOver\(true\), AGE_WAIT_MS\)/);
  });
});

/**
 * Clearing the hint is itself a user update, and `useAuth` publishes every one of
 * those as a new `user`. The sign-up page and the landing route both re-run on a
 * new `user`; with the hint gone that run sends the member to the feed, and its
 * navigation lands after the one to their setup and wins. Seen in a browser run:
 * four of the five roles ended on /feed. Each route must therefore stand down
 * once the hint has been used.
 */
describe("using the hint does not route them a second time", () => {
  it("/auth: the first call to use the hint claims it, and every later call stands down", () => {
    const auth = read("../routes/auth.tsx");
    expect(auth).toMatch(/const usedStartHint = useRef\(false\)/);
    // Stands down on entry, before anything is read or awaited...
    expect(auth).toMatch(
      /const goPostAuth = async \(currentUser: User \| null \| undefined = user\) => \{\s*if \(usedStartHint\.current\) return;/,
    );
    // ...and again after its own awaits, claiming the hint with no await in between, so two
    // calls that started together cannot both use it.
    expect(auth).toMatch(
      /if \(startDestination && dest === startDestination\) \{\s*if \(usedStartHint\.current\) return;\s*usedStartHint\.current = true;\s*await withTimeout\(clearStartHint\(\), 2000, undefined\);/,
    );
  });

  it("/: once it has sent them to their setup, a re-run with a fresh user does nothing", () => {
    const index = read("../routes/index.tsx");
    expect(index).toMatch(/const startedSetup = useRef\(false\)/);
    expect(index).toMatch(/if \(loading \|\| !user \|\| startedSetup\.current\) return;/);
  });
});

describe("one selection, no fork", () => {
  it("has no 'who is this for?' or 'what will you manage?' screen left", () => {
    expect(exists("../routes/onboarding.setup-for.tsx")).toBe(false);
    expect(exists("../routes/onboarding.manage.tsx")).toBe(false);
    expect(exists("../components/AccountTypePicker.tsx")).toBe(false);
  });

  it("links to neither of them from anywhere else", () => {
    for (const rel of [
      "../routes/auth.tsx",
      "../routes/index.tsx",
      "../routes/__root.tsx",
      "../routes/onboarding.welcome.tsx",
      "../routes/players.add.tsx",
      "../components/onboarding/AccountTypeScreen.tsx",
      "../components/RolePicker.tsx",
      "./account-type.ts",
      "./age-verification.ts",
      "./post-auth-destination.ts",
    ]) {
      expect(read(rel), rel).not.toMatch(/\/onboarding\/(setup-for|manage)/);
    }
  });

  it("lets a parent skip Add your child without being forced into it", () => {
    const add = read("../routes/players.add.tsx");
    expect(add).toMatch(/from === "onboarding"/);
    expect(add).toMatch(/to="\/parent"/);
    expect(add).toMatch(/Skip for now/);
  });
});

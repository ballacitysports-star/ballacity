import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPE_ROUTE } from "@/lib/age-verification";
import { hrefForSetup, type AccountType } from "@/lib/account-type";
import {
  DEFAULT_POST_AUTH_DESTINATION,
  defaultHomeFor,
  postAuthDestination,
} from "@/lib/post-auth-destination";

/**
 * Regression: a brand-new guardian account signing in from a consent link
 * (`/parent/consent/:token`) used to be sent to `/onboarding/account-type`
 * first, because `goPostAuth` checked `needsAccountType` before it ever
 * looked at `next`. That contradicts `AuthGate`, which already treats
 * `/parent/*` as an account-setup escape and skips the type gate there —
 * so a guardian with no player/team/trainer/gym answer to give was
 * stranded one step before the screen they were emailed a link to.
 */

describe("postAuthDestination", () => {
  it("honors a next that is an account-setup escape even for a brand-new account", () => {
    const dest = postAuthDestination({
      next: "/parent/consent/abc123",
      needsAccountType: true,
      lastVisited: undefined,
      referrer: undefined,
    });
    expect(dest).toBe("/parent/consent/abc123");
  });

  it("sends an unresolved account to the type picker when next is an ordinary route", () => {
    const dest = postAuthDestination({
      next: "/feed",
      needsAccountType: true,
      lastVisited: undefined,
      referrer: undefined,
    });
    expect(dest).toBe(ACCOUNT_TYPE_ROUTE);
  });

  it("sends an unresolved account to the type picker when next is absent", () => {
    const dest = postAuthDestination({
      next: undefined,
      needsAccountType: true,
      lastVisited: "/games/42",
      referrer: "/feed",
    });
    expect(dest).toBe(ACCOUNT_TYPE_ROUTE);
  });

  it("honors next once the account type is resolved", () => {
    const dest = postAuthDestination({
      next: "/games/42",
      needsAccountType: false,
      lastVisited: undefined,
      referrer: undefined,
    });
    expect(dest).toBe("/games/42");
  });

  it("falls back to last-visited, then referrer, then the default surface", () => {
    expect(
      postAuthDestination({
        next: undefined,
        needsAccountType: false,
        lastVisited: "/games/42",
        referrer: "/players",
      }),
    ).toBe("/games/42");

    expect(
      postAuthDestination({
        next: undefined,
        needsAccountType: false,
        lastVisited: undefined,
        referrer: "/players",
      }),
    ).toBe("/players");

    expect(
      postAuthDestination({
        next: undefined,
        needsAccountType: false,
        lastVisited: undefined,
        referrer: undefined,
      }),
    ).toBe(DEFAULT_POST_AUTH_DESTINATION);
  });

  it("honors the safety/legal and Parent Center escapes too, not just guardian consent", () => {
    for (const next of ["/safety/children", "/account/legal", "/parent"]) {
      expect(postAuthDestination({ next, needsAccountType: true })).toBe(next);
    }
  });
});

/**
 * A member who chose a role at sign-up carries a hint (`start_as`) until it has
 * sent them to that role's setup. The hint only ever adds one redirect; it never
 * takes away a page someone asked for, and never gets ahead of a question the
 * account has to answer first.
 */
describe("postAuthDestination with a setup chosen at sign-up", () => {
  const base = { needsAccountType: false, lastVisited: undefined, referrer: undefined };
  const setups = ["player", "child", "team", "coach", "facility"] as const;

  it.each(setups)("sends %s straight to its setup before anything merely visited", (setup) => {
    const startDestination = hrefForSetup(setup);
    expect(postAuthDestination({ ...base, next: undefined, startDestination })).toBe(
      startDestination,
    );
    expect(
      postAuthDestination({
        ...base,
        next: undefined,
        startDestination,
        lastVisited: "/games/42",
        referrer: "/players",
      }),
    ).toBe(startDestination);
  });

  it("goes where the roles say", () => {
    expect(hrefForSetup("player")).toBe("/onboarding/welcome");
    expect(hrefForSetup("child")).toBe("/players/add?from=onboarding");
    expect(hrefForSetup("team")).toBe("/teams/create");
    expect(hrefForSetup("coach")).toBe("/trainers/create");
    expect(hrefForSetup("facility")).toBe("/orgs/create");
  });

  it("keeps the page they explicitly asked for", () => {
    expect(
      postAuthDestination({ ...base, next: "/games/42", startDestination: "/orgs/create" }),
    ).toBe("/games/42");
  });

  it("still sends an unresolved account to the type picker first", () => {
    expect(
      postAuthDestination({
        next: undefined,
        needsAccountType: true,
        startDestination: "/orgs/create",
        lastVisited: undefined,
        referrer: undefined,
      }),
    ).toBe(ACCOUNT_TYPE_ROUTE);
  });

  it("still honours an account-setup escape, such as a consent link", () => {
    expect(
      postAuthDestination({
        ...base,
        next: "/parent/consent/abc123",
        startDestination: "/players/add?from=onboarding",
      }),
    ).toBe("/parent/consent/abc123");
  });

  it("changes nothing without one", () => {
    expect(postAuthDestination({ ...base, next: undefined })).toBe(DEFAULT_POST_AUTH_DESTINATION);
    expect(postAuthDestination({ ...base, next: undefined, startDestination: undefined })).toBe(
      DEFAULT_POST_AUTH_DESTINATION,
    );
  });
});

/**
 * A guardian's default landing is /parent, not /feed — but only ever as the
 * last resort: an explicit next, a startDestination, or lastVisited/referrer
 * all still win, exactly as they do for every other kind.
 */
describe("defaultHomeFor", () => {
  it("sends a parent profile to /parent", () => {
    expect(defaultHomeFor("parent")).toBe("/parent");
  });

  it.each(["player", "team", "trainer", "gym", null, undefined] as const)(
    "sends everything else to the default surface: %s",
    (kind) => {
      expect(defaultHomeFor(kind as AccountType | null | undefined)).toBe(
        DEFAULT_POST_AUTH_DESTINATION,
      );
    },
  );
});

describe("postAuthDestination with an active profile kind", () => {
  it("falls back to /parent only once next, startDestination, lastVisited and referrer are all absent", () => {
    expect(
      postAuthDestination({
        next: undefined,
        needsAccountType: false,
        activeProfileKind: "parent",
      }),
    ).toBe("/parent");
  });

  it("still prefers lastVisited, referrer, next and startDestination over the guardian default", () => {
    const base = { next: undefined, needsAccountType: false, activeProfileKind: "parent" as const };
    expect(postAuthDestination({ ...base, lastVisited: "/games/42" })).toBe("/games/42");
    expect(postAuthDestination({ ...base, referrer: "/players" })).toBe("/players");
    expect(postAuthDestination({ ...base, startDestination: "/teams/create" })).toBe(
      "/teams/create",
    );
    expect(
      postAuthDestination({
        next: "/games/1",
        needsAccountType: false,
        activeProfileKind: "parent",
      }),
    ).toBe("/games/1");
  });

  it("does not change an unresolved account's trip to the type picker", () => {
    expect(
      postAuthDestination({ next: undefined, needsAccountType: true, activeProfileKind: "parent" }),
    ).toBe(ACCOUNT_TYPE_ROUTE);
  });
});

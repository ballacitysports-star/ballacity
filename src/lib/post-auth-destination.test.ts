import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPE_ROUTE, MANAGER_ROUTE } from "@/lib/age-verification";
import { DEFAULT_POST_AUTH_DESTINATION, postAuthDestination } from "@/lib/post-auth-destination";

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
 * A member who signed up as Parent / Guardian / Owner is stored as a player and
 * carries a hint (`hasManagerHint`) until they have said what they will manage.
 * The hint only ever adds one screen; it never takes away a page someone asked
 * for, and never gets ahead of a question the account has to answer first.
 */
describe("postAuthDestination with the manager hint", () => {
  const base = { needsAccountType: false, lastVisited: undefined, referrer: undefined };

  it("asks what they will manage before anything they merely visited", () => {
    expect(postAuthDestination({ ...base, next: undefined, startAsManager: true })).toBe(
      MANAGER_ROUTE,
    );
    expect(
      postAuthDestination({
        ...base,
        next: undefined,
        startAsManager: true,
        lastVisited: "/games/42",
        referrer: "/players",
      }),
    ).toBe(MANAGER_ROUTE);
  });

  it("keeps the page they explicitly asked for", () => {
    expect(postAuthDestination({ ...base, next: "/games/42", startAsManager: true })).toBe(
      "/games/42",
    );
  });

  it("still sends an unresolved account to the type picker first", () => {
    expect(
      postAuthDestination({
        next: undefined,
        needsAccountType: true,
        startAsManager: true,
        lastVisited: undefined,
        referrer: undefined,
      }),
    ).toBe(ACCOUNT_TYPE_ROUTE);
  });

  it("still honours an account-setup escape, such as a consent link", () => {
    expect(
      postAuthDestination({ ...base, next: "/parent/consent/abc123", startAsManager: true }),
    ).toBe("/parent/consent/abc123");
  });

  it("changes nothing without the hint", () => {
    expect(postAuthDestination({ ...base, next: undefined, startAsManager: false })).toBe(
      DEFAULT_POST_AUTH_DESTINATION,
    );
    expect(postAuthDestination({ ...base, next: undefined })).toBe(DEFAULT_POST_AUTH_DESTINATION);
  });
});

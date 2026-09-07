import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findAdHocContainers, filesWithAdHocContainers } from "./page-shell-audit";

/**
 * The migration net.
 *
 * The app is moving its page containers onto the `page-shell*` scale. Until
 * that finishes, this pins the exact set of route files still hand-rolling a
 * container. Two things follow:
 *
 *   - a new route that centres and caps its own width fails the build, so the
 *     inconsistency cannot grow while the migration is in flight;
 *   - migrating a file fails this test until it is removed from the list,
 *     which keeps the list honest about how much is left.
 *
 * Deleting an entry is the last step of migrating that file. The list should
 * only ever get shorter; when it empties, this becomes a plain assertion that
 * no route hand-rolls a container and the allowlist can go.
 */
const ROUTES_DIR = new URL("../routes/", import.meta.url);

function readRoutes(): Record<string, string> {
  const files = readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".tsx"));
  return Object.fromEntries(files.map((f) => [f, readFileSync(new URL(f, ROUTES_DIR), "utf8")]));
}

/**
 * Route files that still hand-roll a page container. Remove an entry when you
 * move that file onto a page shell — never add one.
 */
const NOT_YET_MIGRATED = new Set([
  "[.]lovable.oauth.consent.tsx",
  "_tabs.create.tsx",
  "_tabs.feed.tsx",
  "_tabs.notifications.tsx",
  "_tabs.players.tsx",
  "_tabs.profile.tsx",
  "_tabs.teams.tsx",
  "_tabs.trainers.tsx",
  "account.ai-privacy.tsx",
  "account.blocked.tsx",
  "account.data.tsx",
  "account.legal.tsx",
  "account.notifications.tsx",
  "account.privacy.tsx",
  "account.security.tsx",
  "admin.index.tsx",
  "auth.tsx",
  "community-guidelines.tsx",
  "contact.tsx",
  "dev.og-preview.tsx",
  "dev.route-doctor.tsx",
  "family.join.$token.tsx",
  "games.$gameId.pay.tsx",
  "games.$gameId.payment-setup.tsx",
  "index.tsx",
  "messages.$conversationId.tsx",
  "messages.index.tsx",
  "onboarding.child.tsx",
  "onboarding.welcome.tsx",
  "orgs.$orgId.edit.tsx",
  "orgs.$orgId.index.tsx",
  "orgs.$orgId.members.tsx",
  "orgs.create.tsx",
  "orgs.index.tsx",
  "parent.consent.$token.tsx",
  "parent.index.tsx",
  "payments.tsx",
  "plans.tsx",
  "player-card.$userId.tsx",
  "players.$userId.tsx",
  "privacy.tsx",
  "profile.edit.tsx",
  "reset-password.tsx",
  "review.new.tsx",
  "reviews.tsx",
  "safety.tsx",
  "safety_.children.tsx",
  "settings.tsx",
  "shop.tsx",
  "teams.$teamId.edit.tsx",
  "teams.$teamId.index.tsx",
  "teams.create.tsx",
  "terms.tsx",
  "trainers.$trainerId.edit.tsx",
  "trainers.$trainerId.index.tsx",
  "trainers.create.tsx",
  "trust-center.tsx",
]);

describe("page container migration", () => {
  const sources = readRoutes();

  it("adds no new hand-rolled containers", () => {
    const offenders = filesWithAdHocContainers(sources);
    const added = offenders.filter((f) => !NOT_YET_MIGRATED.has(f));
    expect(
      added,
      "These routes centre and cap their own width. Use a page shell " +
        "(page-shell-narrow / page-shell-content / page-shell / page-shell-full) " +
        "or the <PageContainer> wrapper instead.",
    ).toEqual([]);
  });

  it("keeps the allowlist free of files that are already migrated", () => {
    const offenders = new Set(filesWithAdHocContainers(sources));
    const stale = [...NOT_YET_MIGRATED].filter((f) => !offenders.has(f)).sort();
    expect(
      stale,
      "These routes no longer hand-roll a container, so drop them from " +
        "NOT_YET_MIGRATED to lock the improvement in.",
    ).toEqual([]);
  });

  it("keeps the allowlist free of files that no longer exist", () => {
    const known = new Set(Object.keys(sources));
    const missing = [...NOT_YET_MIGRATED].filter((f) => !known.has(f)).sort();
    expect(missing).toEqual([]);
  });

  it("reports the remaining work", () => {
    // Not a threshold to satisfy — just keeps the number visible in the suite
    // so the migration cannot quietly stall.
    expect(NOT_YET_MIGRATED.size).toBeGreaterThanOrEqual(0);
  });
});

describe("findAdHocContainers", () => {
  it("ignores a container already using a page shell", () => {
    expect(findAdHocContainers("x.tsx", '<div className="page-shell py-4 max-w-5xl" />')).toEqual(
      [],
    );
    expect(findAdHocContainers("x.tsx", '<div className="page-shell-content py-4" />')).toEqual([]);
  });

  it("ignores centring that does not cap width", () => {
    expect(findAdHocContainers("x.tsx", '<div className="mx-auto flex gap-2" />')).toEqual([]);
  });

  it("ignores a width cap that is not a page container", () => {
    // A capped element that does not centre itself is a card or a column,
    // not a page container.
    expect(findAdHocContainers("x.tsx", '<p className="max-w-prose" />')).toEqual([]);
  });

  it("flags a hand-rolled container", () => {
    const [found] = findAdHocContainers(
      "x.tsx",
      '<div className="mx-auto w-full max-w-md px-4" />',
    );
    expect(found?.widths).toEqual(["max-w-md"]);
    expect(found?.fixed).toBe(true);
    expect(found?.unpadded).toBe(false);
  });

  it("marks a container responsive when any width is breakpointed", () => {
    const [found] = findAdHocContainers(
      "x.tsx",
      '<div className="mx-auto w-full max-w-md sm:max-w-2xl px-4" />',
    );
    expect(found?.fixed).toBe(false);
  });

  it("marks a container unpadded when it sets no horizontal padding", () => {
    const [found] = findAdHocContainers("x.tsx", '<div className="mx-auto max-w-xl pb-4" />');
    expect(found?.unpadded).toBe(true);
  });

  it("counts p-4 and breakpointed padding as horizontal padding", () => {
    expect(
      findAdHocContainers("x.tsx", '<div className="mx-auto max-w-xl p-4" />')[0]?.unpadded,
    ).toBe(false);
    expect(
      findAdHocContainers("x.tsx", '<div className="mx-auto max-w-xl sm:px-6" />')[0]?.unpadded,
    ).toBe(false);
  });

  it("reads template-literal className values too", () => {
    const src = "<div className={`mx-auto max-w-md ${extra}`} />";
    expect(findAdHocContainers("x.tsx", src)).toHaveLength(1);
  });
});

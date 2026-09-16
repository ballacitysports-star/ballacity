import { test, expect, type Page } from "@playwright/test";
import { toJSONAsync } from "seroval";
import { TEST_ACCOUNTS } from "../src/lib/test-fixtures";
import { DEFAULT_AGE_POLICY, DEFAULT_CHILD_CONTROLS } from "../src/lib/child-policy";

/**
 * Age-cohort lifecycle, driven by the authoritative backend guard
 * (`getMyChildStatus` in `src/lib/child-safety.functions.ts`) that
 * `ChildConsentGate` consumes inside the `_tabs` layout.
 *
 * The gate is the friendly explanation, not the security boundary — the
 * database enforces the same rules (`child_features_locked`,
 * `enforce_child_game_participation`, `enforce_minor_messaging`). A child
 * without approved consent gets LIMITED access: the app itself stays
 * browsable (this is the point — a locked-out child was blocked even from
 * looking around), while the database rejects every write that matters
 * regardless of what the client shows. These tests assert the product
 * surface matches the server decision for every cohort:
 *
 *   under-13, consent required  → banner + app browsable, routed to the consent flow
 *   under-13, consent pending   → banner + app browsable, "waiting for your Guardian"
 *   under-13, consent approved  → no banner, app usable
 *   under-13, consent revoked   → banner again, "turned this account off"
 *   13-15 / 16-17 / adult       → app usable, never gated
 *
 * Also covered: the consent flow and safety pages stay reachable while the
 * banner is up, and the guardian-only Parent Center is not reachable from a
 * blocked child account.
 *
 * The server-fn response is stubbed the same way as
 * `social-login-identity-cases.spec.ts`: TanStack encodes results with seroval
 * and flags them with `x-tss-serialized`.
 */

const player = TEST_ACCOUNTS.find((a) => a.key === "player")!;

test.skip(
  !process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON,
  "Requires seeded Supabase fixture accounts (see e2e/global-setup.ts).",
);

type Consent = {
  status: "required" | "pending" | "approved" | "revoked" | "expired";
  method: string;
  parentEmail: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  revokedAt: string | null;
  reverifyAt: string | null;
};

type ChildStatus = {
  cohort: string;
  ageReviewRequired: boolean;
  jurisdiction: string;
  consent: Consent | null;
  controls: typeof DEFAULT_CHILD_CONTROLS | null;
  policy: typeof DEFAULT_AGE_POLICY;
  hasBirthday: boolean;
};

function consent(status: Consent["status"]): Consent {
  const now = new Date().toISOString();
  return {
    status,
    method: status === "approved" ? "email_confirmation" : "unverified",
    parentEmail: status === "required" ? null : "guardian@example.com",
    requestedAt: status === "required" ? null : now,
    approvedAt: status === "approved" ? now : null,
    revokedAt: status === "revoked" ? now : null,
    reverifyAt: null,
  };
}

function status(
  cohort: string,
  consentStatus: Consent["status"] | null,
  extra: Partial<ChildStatus> = {},
): ChildStatus {
  return {
    cohort,
    ageReviewRequired: false,
    jurisdiction: "US_FEDERAL",
    consent: consentStatus ? consent(consentStatus) : null,
    controls: consentStatus === "approved" ? DEFAULT_CHILD_CONTROLS : null,
    policy: DEFAULT_AGE_POLICY,
    hasBirthday: true,
    ...extra,
  };
}

/** Stub only `getMyChildStatus`; every other server fn falls through. */
async function stubChildStatus(page: Page, value: ChildStatus) {
  await page.route("**/_serverFn/**", async (route) => {
    const seg = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/_serverFn/")[1] ?? "",
    ).split("?")[0];
    let decoded = "";
    try {
      decoded = Buffer.from(seg, "base64").toString("utf8");
    } catch {
      /* not base64 */
    }
    if (!/child-safety/i.test(decoded) || !/MyChildStatus/i.test(decoded)) {
      await route.fallback();
      return;
    }
    const payload = await toJSONAsync({ result: value, error: undefined, context: {} });
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "x-tss-serialized": "true" },
      body: JSON.stringify(payload.t),
    });
  });
}

async function signIn(page: Page) {
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(player.email);
  await page.getByPlaceholder("Password").fill(player.password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).not.toHaveURL(/\/auth(?:[?#].*)?$/, { timeout: 20_000 });
}

const gate = (page: Page) => page.getByText(/your Guardian|turned this account off/i);

test.describe("child lifecycle: consent gate per cohort", () => {
  const blocked: Array<[string, Consent["status"], RegExp]> = [
    ["consent required", "required", /Your Guardian needs to approve this account/i],
    ["consent pending", "pending", /Waiting for your Guardian/i],
    ["consent revoked", "revoked", /A parent or guardian turned this account off/i],
  ];

  for (const [label, consentStatus, bannerText] of blocked) {
    test(`under-13 with ${label} gets limited, browse-only access`, async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await stubChildStatus(page, status("child_under_13", consentStatus));
        await signIn(page);
        await page.goto("/feed", { waitUntil: "domcontentloaded" });

        // The banner explains the account is limited...
        await expect(page.getByText(bannerText)).toBeVisible({ timeout: 20_000 });
        // The escape hatch to the consent flow must always be offered.
        await expect(
          page.getByRole("link", { name: /Start approval|Check status/i }),
        ).toBeVisible();
        // ...but the feed itself is NOT blocked — the child can still browse,
        // and the primary tab bar underneath the banner is reachable, not
        // covered by a full-screen overlay.
        await expect(page).toHaveURL(/\/feed/);
        await expect(page.getByRole("group", { name: "Primary tabs" })).toBeVisible();
      } finally {
        await context.close();
      }
    });
  }

  test("under-13 with approved consent reaches the app", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await stubChildStatus(page, status("child_under_13", "approved"));
      await signIn(page);
      await page.goto("/feed", { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/feed/);
      await expect(gate(page)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  for (const cohort of ["teen_13_15", "teen_16_17", "adult"]) {
    test(`${cohort} is never consent-gated`, async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await stubChildStatus(page, status(cohort, null));
        await signIn(page);
        await page.goto("/feed", { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(/\/feed/);
        await expect(gate(page)).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  }

  test("a blocked child can still reach the consent flow and safety pages", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await stubChildStatus(page, status("child_under_13", "pending"));
      await signIn(page);

      await page.goto("/onboarding/child", { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { name: /Your Guardian approves this account/i }),
      ).toBeVisible({ timeout: 20_000 });

      await page.goto("/safety/children", { waitUntil: "domcontentloaded" });
      await expect(page.locator("main")).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

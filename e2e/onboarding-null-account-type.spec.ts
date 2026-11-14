import { test, expect, type Page } from "@playwright/test";
import { toJSONAsync } from "seroval";
import { emitSignedIn, expectAccountTypePickerInPlace } from "./helpers/oauth-signin";
import { onboardingStatusFor, stubServerFn } from "./helpers/server-fn";

/**
 * Integration test: any signed-in user whose `profiles.account_type` is NULL
 * must see the account-type picker before protected content, regardless of how
 * they signed in (Google, Apple, or email). We simulate this by intercepting the
 * PostgREST call the root gate makes to read `profiles.account_type` and
 * returning `null`.
 *
 * Covers both entry points:
 *  1. `SIGNED_IN` reconcile in `onAuthStateChange` (fires on OAuth return).
 *  2. Route-level `typeStatus` gate on any protected navigation.
 *
 * It also covers the picker itself: one role selection, then straight to that
 * role's setup (see "role picker" at the bottom).
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

// `/notifications` is no longer a page of its own: alerts live in the Inbox
// (`/messages`), and the old path redirects there.
const PROTECTED_ROUTES = ["/feed", "/profile", "/messages"] as const;
const PROVIDERS = ["google", "apple"] as const;

async function stubNullAccountType(page: Page) {
  // The root gate asks the server first (getOnboardingStatus reads the profile
  // server-side), so the table stub below only covers its client fallback.
  await stubServerFn(page, "getOnboardingStatus", onboardingStatusFor(null, "email"));
  // The root gate hits `/rest/v1/profiles?select=account_type&id=eq.<uid>`.
  // Force every read of that column to return NULL so the redirect logic runs
  // even for users who actually have a type in the real DB.
  await page.route(/\/rest\/v1\/profiles\?[^ ]*select=account_type/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([{ account_type: null }]),
    });
  });
}

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key!, value!);
      // Ensure no pre-OAuth pending choice interferes with the null test.
      window.localStorage.removeItem("openrun:pending-account-type");
    },
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

test.describe("null account_type → account-type setup", () => {
  for (const route of PROTECTED_ROUTES) {
    test(`route gate: visiting ${route} with null account_type shows onboarding in place`, async ({
      browser,
    }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await stubNullAccountType(page);
        await restoreSession(page);

        await page.goto(route, { waitUntil: "domcontentloaded" });

        await expect(page).toHaveURL(new RegExp(route));
        await expect(
          page.getByRole("heading", { name: /Where do you want to start/i }),
        ).toBeVisible({
          timeout: 15_000,
        });
        await expect(page.getByRole("button", { name: /Player/i })).toBeVisible();
      } finally {
        await context.close();
      }
    });
  }

  for (const provider of PROVIDERS) {
    test(`SIGNED_IN reconcile: ${provider} return with null account_type redirects to onboarding`, async ({
      browser,
    }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await stubNullAccountType(page);
        await restoreSession(page);

        // Land on a public-ish route first so the SIGNED_IN handler owns the
        // decision (mirrors the OAuth callback returning to `window.location.origin`).
        await page.goto("/", { waitUntil: "domcontentloaded" });

        // The app shell registers its sign-in listener when it mounts, after
        // hydration; the gate holding the member at the picker shows it is up.
        await expectAccountTypePickerInPlace(page);

        // Simulate the provider callback firing a SIGNED_IN event on the
        // existing Supabase client. Every provider that lands back in-app
        // takes this path — this is the exact hook the OAuth return relies on.
        await emitSignedIn(page);
        await page.evaluate((providerId) => {
          // Tag the run so we can confirm the provider we simulated.
          (window as unknown as { __simulatedProvider?: string }).__simulatedProvider = providerId;
        }, provider);

        await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          timeout: 15_000,
        });

        const tagged = await page.evaluate(
          () => (window as unknown as { __simulatedProvider?: string }).__simulatedProvider,
        );
        expect(tagged).toBe(provider);
      } finally {
        await context.close();
      }
    });
  }

  test("onboarding page itself is NOT redirected away", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await stubNullAccountType(page);
      await restoreSession(page);

      await page.goto("/onboarding/account-type", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);

      await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/);
    } finally {
      await context.close();
    }
  });
});

/**
 * Role picker: one selection right after sign-up, then straight to that role's
 * setup. Nothing on the fixture account changes: the account-type save is a
 * stubbed PATCH, and the age cohort is stubbed so the Parent / Guardian card does
 * not depend on the fixture's birth date. So this checks where each role goes,
 * not what the database does with the type.
 */

/** Which server fn is this `_serverFn` request for? */
function serverFnId(url: string): string {
  const seg = decodeURIComponent(new URL(url).pathname.split("/_serverFn/")[1] ?? "").split("?")[0];
  try {
    return Buffer.from(seg ?? "", "base64").toString("utf8");
  } catch {
    return seg ?? "";
  }
}

/** Answer `getMyAgeStatus` as a member of this cohort; every other server fn falls through. */
async function stubAgeCohort(page: Page, cohort: "adult" | "teen_16_17") {
  await page.route("**/_serverFn/**", async (route) => {
    if (!/getMyAgeStatus/.test(serverFnId(route.request().url()))) {
      await route.fallback();
      return;
    }
    const status = {
      cohort,
      ageCategory: cohort,
      reviewRequired: false,
      status: "active",
      birthdaySet: true,
    };
    const payload = await toJSONAsync({ result: status, error: undefined, context: {} });
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "x-tss-serialized": "true" },
      body: JSON.stringify(payload.t),
    });
  });
}

/** Swallow the account-type save, and hand back what was sent. */
async function stubAccountTypeSave(page: Page): Promise<string[]> {
  const saved: string[] = [];
  // Picking Parent / Guardian also marks the auth user as a guardian. That must
  // not reach the shared fixture account: a guardian fixture is in Parent Mode
  // and loses every join and pay control for the rest of the suite.
  await page.route(/\/auth\/v1\/user(?:\?|$)/, async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 400, contentType: "application/json", body: "{}" });
  });
  await page.route(/\/rest\/v1\/profiles\?/, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }
    saved.push(route.request().postData() ?? "");
    await route.fulfill({ status: 204, body: "" });
  });
  return saved;
}

async function openPicker(page: Page, cohort: "adult" | "teen_16_17" = "adult") {
  await stubNullAccountType(page);
  await stubAgeCohort(page, cohort);
  const saved = await stubAccountTypeSave(page);
  await restoreSession(page);
  await page.goto("/feed", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Where do you want to start/i })).toBeVisible({
    timeout: 15_000,
  });
  return saved;
}

const ROLE_CARDS: [label: string, blurb: string][] = [
  ["Player", "Athletes looking for games and runs"],
  ["Parent / Guardian", "Parents managing kids' sports schedules"],
  ["Team / Coach", "Coaches and captains organizing squads"],
  ["Facility / Venue", "Venue owners and sports facilities"],
];

const ROLE_SETUPS = [
  {
    name: "Player",
    pick: async (page: Page) => page.getByRole("button", { name: /Player/i }).click(),
    saves: "player",
    goes: /\/onboarding\/welcome(?:[?#].*)?$/,
  },
  {
    name: "Parent / Guardian",
    pick: async (page: Page) => page.getByRole("button", { name: /Parent \/ Guardian/ }).click(),
    saves: "player",
    goes: /\/players\/add\?from=onboarding$/,
  },
  {
    name: "Team / Coach, Team",
    pick: async (page: Page) => {
      await page.getByRole("button", { name: /Team \/ Coach/ }).click();
      await page.getByRole("group").getByRole("button", { name: /^Team/ }).click();
    },
    saves: "team",
    goes: /\/teams\/create(?:\?finish=1)?$/,
  },
  {
    name: "Team / Coach, Coach",
    pick: async (page: Page) => {
      await page.getByRole("button", { name: /Team \/ Coach/ }).click();
      await page
        .getByRole("group")
        .getByRole("button", { name: /^Coach/ })
        .click();
    },
    saves: "trainer",
    goes: /\/trainers\/create(?:\?finish=1)?$/,
  },
  {
    name: "Facility / Venue",
    pick: async (page: Page) => page.getByRole("button", { name: /Facility \/ Venue/ }).click(),
    saves: "gym",
    goes: /\/orgs\/create(?:\?finish=1)?$/,
  },
];

test.describe("role picker: one selection, straight to that role's setup", () => {
  test("offers the four roles, with who each is for", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openPicker(page);
      for (const [label, blurb] of ROLE_CARDS) {
        const card = page.getByRole("button", { name: new RegExp(label) });
        await expect(card).toBeVisible();
        await expect(card).toContainText(blurb);
      }
      // Nothing is chosen, so there is nothing to continue with yet.
      await expect(page.getByRole("button", { name: /^Continue$/ })).toBeDisabled();
    } finally {
      await context.close();
    }
  });

  for (const role of ROLE_SETUPS) {
    test(`${role.name} goes straight to its setup`, async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        const saved = await openPicker(page);
        await role.pick(page);
        await page.getByRole("button", { name: /^Continue$/ }).click();
        await expect(page).toHaveURL(role.goes, { timeout: 30_000 });
        expect(saved.some((body) => body.includes(`"account_type":"${role.saves}"`))).toBe(true);
        // It stays there: no bounce back to a picker or a second question.
        await page.waitForTimeout(1500);
        await expect(page).toHaveURL(role.goes);
      } finally {
        await context.close();
      }
    });
  }

  test("Team / Coach asks which one on the same screen, and waits for an answer", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openPicker(page);
      await expect(page.getByText("Which one are you setting up?")).toHaveCount(0);
      await page.getByRole("button", { name: /Team \/ Coach/ }).click();
      await expect(page.getByText("Which one are you setting up?")).toBeVisible();
      await expect(page.getByRole("group").getByRole("button", { name: /^Team/ })).toBeVisible();
      await expect(page.getByRole("group").getByRole("button", { name: /^Coach/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Continue$/ })).toBeDisabled();
      await expect(page).toHaveURL(/\/feed/);
    } finally {
      await context.close();
    }
  });

  test("a member under 18 is not offered Parent / Guardian", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openPicker(page, "teen_16_17");
      await expect(page.getByRole("button", { name: /Player/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /Team \/ Coach/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Facility \/ Venue/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Parent \/ Guardian/ })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("the standalone page sends a parent to Add your child too", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await stubNullAccountType(page);
      await stubAgeCohort(page, "adult");
      const saved = await stubAccountTypeSave(page);
      await restoreSession(page);
      await page.goto("/onboarding/account-type", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /Parent \/ Guardian/ }).click();
      await page.getByRole("button", { name: /^Continue$/ }).click();
      await expect(page).toHaveURL(/\/players\/add\?from=onboarding$/, { timeout: 30_000 });
      expect(saved.some((body) => body.includes('"account_type":"player"'))).toBe(true);
    } finally {
      await context.close();
    }
  });
});

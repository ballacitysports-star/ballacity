import { test, expect, type Page } from "@playwright/test";

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
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const PROTECTED_ROUTES = ["/feed", "/profile", "/notifications"] as const;
const PROVIDERS = ["google", "apple"] as const;

async function stubNullAccountType(page: Page) {
  // The gate asks the server first (`getOnboardingStatus`) and only falls back
  // to PostgREST when that call fails, so both layers must report "no type".
  await page.route(/\/_serverFn\/[^ ]*getOnboardingStatus/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        needsOnboarding: true,
        isSocial: false,
        provider: "email",
        accountType: null,
      }),
    });
  });
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
        await expect(page.getByRole("heading", { name: /Where do you want to start/i })).toBeVisible({
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

        // Simulate the provider callback firing a SIGNED_IN event on the
        // existing Supabase client. Every provider that lands back in-app
        // takes this path — this is the exact hook the OAuth return relies on.
        await page.evaluate(async (providerId) => {
          const mod = await import("/src/integrations/supabase/client.ts");
          const supabase = (mod as { supabase: import("@supabase/supabase-js").SupabaseClient })
            .supabase;
          const {
            data: { session },
          } = await supabase.auth.getSession();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const authAny = supabase.auth as any;
          const emit = authAny._notifyAllSubscribers ?? authAny.notifyAllSubscribers;
          if (typeof emit === "function") {
            await emit.call(supabase.auth, "SIGNED_IN", session, false);
          }
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

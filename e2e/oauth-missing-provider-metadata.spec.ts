import { test, expect, type Page } from "@playwright/test";
import { emitSignedIn, expectAccountTypePickerInPlace } from "./helpers/oauth-signin";
import { onboardingStatusFor, stubServerFn } from "./helpers/server-fn";

/**
 * Regression: an OAuth return where the session omits provider metadata
 * (no `app_metadata.provider`, no `openrun:oauth-provider` sessionStorage
 * marker) must STILL route a brand-new social user to
 * `/onboarding/account-type`, because the backend `getOnboardingStatus`
 * guard in `src/lib/onboarding.functions.ts` inspects the user's linked
 * identities via the admin API and reports `isSocial: true`.
 *
 * Any saved `pending` account type and `next` route must be preserved so
 * onboarding can honor them after the picker.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const PROVIDERS = ["google", "apple"] as const;

const PENDING_KEY = "openrun.pending_account_type";
const NEXT_KEY = "openrun:oauth-next";
const PROVIDER_KEY = "openrun:oauth-provider";
const NEXT_PATH = "/feed?src=oauth-missing-meta";

async function stubBackend(page: Page, serverProvider: "google" | "apple") {
  // The authoritative guard is the server fn, which sees the linked identity
  // even when the browser session carries no provider metadata.
  await stubServerFn(page, "getOnboardingStatus", onboardingStatusFor(null, serverProvider));
  // Profile lookup: brand-new user, no account_type yet.
  await page.route(/\/rest\/v1\/profiles\?.*select=account_type/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([{ account_type: null }]),
    });
  });

  // Client MUST NOT PATCH the profile from a stashed pending — the picker is
  // the source of truth for social sign-ups.
  await page.route(/\/rest\/v1\/profiles\?.*id=eq\./, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "unexpected profile PATCH" }),
      });
      return;
    }
    await route.fallback();
  });
}

async function primeStorage(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([sbKey, sbValue, pendingKey, nextKey, nextPath, providerKey]) => {
      window.localStorage.setItem(sbKey!, sbValue!);
      window.sessionStorage.setItem(pendingKey!, "player");
      window.sessionStorage.setItem(nextKey!, nextPath!);
      // Intentionally do NOT set the provider marker — this is the exact
      // regression path where all client-visible provider signals are missing.
      window.sessionStorage.removeItem(providerKey!);
    },
    [STORAGE_KEY!, SESSION_JSON!, PENDING_KEY, NEXT_KEY, NEXT_PATH, PROVIDER_KEY] as const,
  );
}

test.describe("OAuth return with missing provider metadata", () => {
  for (const provider of PROVIDERS) {
    test(`${provider}: backend guard routes user to onboarding with state preserved`, async ({
      browser,
    }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await stubBackend(page, provider);
        await primeStorage(page);
        await page.goto("/", { waitUntil: "domcontentloaded" });
        // Raise the OAuth return only once the app shell (and its sign-in
        // listener) is up; the gate holds the member at the picker meanwhile.
        await expectAccountTypePickerInPlace(page);
        // Still on "/": only the listener's redirect may take the member to the
        // picker's own page, so the check below is about the listener.
        await expect(page).not.toHaveURL(/\/onboarding\/account-type/);
        // No `app_metadata.provider` on the session the listener sees.
        await emitSignedIn(page, { provider: null });

        await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          timeout: 15_000,
        });

        const state = await page.evaluate(
          ([pendingKey, nextKey, providerKey]) => ({
            pending: window.sessionStorage.getItem(pendingKey!),
            next: window.sessionStorage.getItem(nextKey!),
            provider: window.sessionStorage.getItem(providerKey!),
          }),
          [PENDING_KEY, NEXT_KEY, PROVIDER_KEY] as const,
        );
        expect(state.pending).toBe("player");
        expect(state.next).toBe(NEXT_PATH);
        // The saved provider marker was intentionally absent and must NOT
        // have been fabricated by the client.
        expect(state.provider).toBeNull();
      } finally {
        await context.close();
      }
    });
  }
});

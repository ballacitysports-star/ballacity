import { test, expect, type Page } from "@playwright/test";
import { emitSignedIn, expectAccountTypePickerInPlace } from "./helpers/oauth-signin";
import { onboardingStatusFor, stubServerFn } from "./helpers/server-fn";

/**
 * A brand-new user signing in with Google or Apple (i.e. `profiles.account_type`
 * is NULL) must always land on `/onboarding/account-type`. Per the OAuth-new-user
 * rule in `src/routes/__root.tsx`, the SIGNED_IN reconcile MUST NOT auto-apply
 * a stashed `pending` account type for social providers — the picker screen is
 * the source of truth. Any saved post-auth `next` path stays in sessionStorage
 * so onboarding can consume it after the user picks a type.
 *
 * Two layers enforce it. The root gate renders the picker in place of any
 * protected page (so a hydrated session on `/` that the landing page forwards to
 * the feed sees the picker, not the feed), and the SIGNED_IN listener sends an
 * OAuth return to `/onboarding/account-type` itself.
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
const NEXT_PATH = "/feed?src=oauth-e2e";

async function stubNullAccountType(
  page: Page,
  serverProvider: "google" | "apple" | "email" = "google",
) {
  // The root gate asks the server first (getOnboardingStatus reads the profile
  // server-side), so the table stub below only covers its client fallback.
  // `serverProvider` is what the server's identity check reports ("email" means
  // it does not see a social sign-in, so `isSocial` is false).
  await stubServerFn(page, "getOnboardingStatus", onboardingStatusFor(null, serverProvider));
  await page.route(/\/rest\/v1\/profiles\?.*select=account_type/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([{ account_type: null }]),
    });
  });

  // Fail loudly if the fix regresses: an OAuth new-user path must NEVER write
  // an account_type into the profile from the client-side pending stash.
  await page.route(/\/rest\/v1\/profiles\?.*id=eq\./, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "unexpected profile PATCH on OAuth new-user" }),
      });
      return;
    }
    await route.fallback();
  });
}

async function primeStorage(page: Page, provider?: "google" | "apple") {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([sbKey, sbValue, pendingKey, nextKey, nextPath, providerKey, providerId]) => {
      window.localStorage.setItem(sbKey!, sbValue!);
      // Stash a pending account type as if the user had picked one on /auth
      // before OAuth. Under the new rule this MUST be ignored for Google/Apple.
      window.sessionStorage.setItem(pendingKey!, "player");
      window.sessionStorage.setItem(nextKey!, nextPath!);
      if (providerId) window.sessionStorage.setItem(providerKey!, providerId);
    },
    [
      STORAGE_KEY!,
      SESSION_JSON!,
      PENDING_KEY,
      NEXT_KEY,
      NEXT_PATH,
      PROVIDER_KEY,
      provider ?? null,
    ] as const,
  );
}

test.describe("OAuth new-user onboarding gate", () => {
  for (const provider of PROVIDERS) {
    test(`${provider}: brand-new user lands on /onboarding/account-type with state preserved`, async ({
      browser,
    }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await stubNullAccountType(page);
        await primeStorage(page, provider);

        // Simulate the provider callback returning to the app origin.
        await page.goto("/", { waitUntil: "domcontentloaded" });

        // The landing page itself is public, so this verifies the real
        // regression path: a hydrated OAuth session on `/` with no account
        // type must be held at the account-type picker instead of staying on
        // marketing or restoring `/feed` from last-visited state. The landing
        // page forwards a signed-in member on, and the root gate renders the
        // picker in place of the page they were forwarded to.
        await expectAccountTypePickerInPlace(page);
        await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/?$/);
        // The feed itself (its header links to the member's profile) is not shown.
        await expect(page.getByRole("link", { name: "Your profile" })).toHaveCount(0);

        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expectAccountTypePickerInPlace(page);
        // Held in place, not yet sent to the picker's own page: that redirect
        // must come from the listener below.
        await expect(page).not.toHaveURL(/\/onboarding\/account-type/);

        // Force the SIGNED_IN reconcile with the correct app_metadata.provider
        // so the "new OAuth user" branch runs. getSession() is patched so the
        // reconcile sees provider=<google|apple> without touching real auth.
        await emitSignedIn(page, { provider });

        await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          timeout: 15_000,
        });

        // Preserved state: pending choice and saved next path must both survive
        // so onboarding can honor them after the user confirms a type.
        const state = await page.evaluate(
          ([pendingKey, nextKey]) => ({
            pending: window.sessionStorage.getItem(pendingKey!),
            next: window.sessionStorage.getItem(nextKey!),
          }),
          [PENDING_KEY, NEXT_KEY] as const,
        );
        expect(state.pending).toBe("player");
        expect(state.next).toBe(NEXT_PATH);
      } finally {
        await context.close();
      }
    });
  }

  test("saved provider marker routes new OAuth user to onboarding even if session metadata is missing", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // The server's identity check does not say "social" either, so only the
      // saved marker can make the listener treat this as an OAuth return
      // (otherwise it would apply the stashed pending type with a PATCH).
      await stubNullAccountType(page, "email");
      await primeStorage(page, "google");
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expectAccountTypePickerInPlace(page);
      await expect(page).not.toHaveURL(/\/onboarding\/account-type/);

      // The session carries no provider; only the saved marker says Google.
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
      expect(state.provider).toBe("google");
    } finally {
      await context.close();
    }
  });
});

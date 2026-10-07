import { test, expect, type Page } from "@playwright/test";
import { stubNewUserOnboarding } from "./helpers/server-fn";

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

  // Answer `getOnboardingStatus` the way the admin-API path would: the caller
  // has no client provider metadata, but the backend still classifies them as
  // social and requiring onboarding. (This used to match `/n/…onboarding…`, a
  // server-fn URL the app no longer uses, so the real server answered.)
  await stubNewUserOnboarding(page, serverProvider);
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

async function stripProviderMetadata(page: Page) {
  await page.evaluate(async () => {
    const mod = await import("/src/integrations/supabase/client.ts");
    const supabase = (mod as { supabase: import("@supabase/supabase-js").SupabaseClient })
      .supabase;
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) throw new Error("no session in test context");
    const strippedAppMeta = { ...(session.user.app_metadata ?? {}) };
    delete (strippedAppMeta as { provider?: unknown }).provider;
    const patched = {
      ...session,
      user: { ...session.user, app_metadata: strippedAppMeta },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authAny = supabase.auth as any;
    authAny.getSession = async () => ({ data: { session: patched }, error: null });
    const emit = authAny._notifyAllSubscribers ?? authAny.notifyAllSubscribers;
    if (typeof emit !== "function") {
      throw new Error("Supabase auth emit hook missing");
    }
    await emit.call(supabase.auth, "SIGNED_IN", patched, false);
  });
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
        await stripProviderMetadata(page);

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

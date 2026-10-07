import { test, expect, type Page } from "@playwright/test";
import { stubNewUserOnboarding } from "./helpers/server-fn";

/**
 * A brand-new user signing in with Google or Apple (i.e. `profiles.account_type`
 * is NULL) must always land on `/onboarding/account-type`. Per the OAuth-new-user
 * rule in `src/routes/__root.tsx`, the SIGNED_IN reconcile MUST NOT auto-apply
 * a stashed `pending` account type for social providers — the picker screen is
 * the source of truth. Any saved post-auth `next` path stays in sessionStorage
 * so onboarding can consume it after the user picks a type.
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

async function stubNullAccountType(page: Page) {
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
    [STORAGE_KEY!, SESSION_JSON!, PENDING_KEY, NEXT_KEY, NEXT_PATH, PROVIDER_KEY, provider ?? null] as const,
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
        await stubNewUserOnboarding(page, provider);
        await primeStorage(page, provider);

        // Simulate the provider callback returning to the app origin.
        await page.goto("/", { waitUntil: "domcontentloaded" });

        // The landing page itself is public, so this verifies the real
        // regression path: a hydrated OAuth session on `/` with no account
        // type must be sent to onboarding instead of staying on marketing or
        // restoring `/feed` from last-visited state.
        await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          timeout: 15_000,
        });

        await page.goto("/", { waitUntil: "domcontentloaded" });

        // Force the SIGNED_IN reconcile with the correct app_metadata.provider
        // so the "new OAuth user" branch runs. We patch getSession() so the
        // reconcile sees provider=<google|apple> without touching real auth.
        await page.evaluate(async (providerId) => {
          const mod = await import("/src/integrations/supabase/client.ts");
          const supabase = (mod as { supabase: import("@supabase/supabase-js").SupabaseClient })
            .supabase;
          const { data } = await supabase.auth.getSession();
          const session = data.session;
          if (!session) throw new Error("no session in test context");
          const patched = {
            ...session,
            user: {
              ...session.user,
              app_metadata: { ...(session.user.app_metadata ?? {}), provider: providerId },
            },
          };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const authAny = supabase.auth as any;
          authAny.getSession = async () => ({ data: { session: patched }, error: null });
          const emit = authAny._notifyAllSubscribers ?? authAny.notifyAllSubscribers;
          if (typeof emit !== "function") {
            throw new Error("Supabase auth emit hook missing");
          }
          await emit.call(supabase.auth, "SIGNED_IN", patched, false);
        }, provider);

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
      await stubNullAccountType(page);
      // No social identity server-side either: the saved marker is the only signal.
      await stubNewUserOnboarding(page, null);
      await primeStorage(page, "google");
      await page.goto("/", { waitUntil: "domcontentloaded" });

      await page.evaluate(async () => {
        const mod = await import("/src/integrations/supabase/client.ts");
        const supabase = (mod as { supabase: import("@supabase/supabase-js").SupabaseClient })
          .supabase;
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (!session) throw new Error("no session in test context");
        const patched = {
          ...session,
          user: {
            ...session.user,
            app_metadata: { ...(session.user.app_metadata ?? {}), provider: undefined },
          },
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

import { test, expect, type Page } from "@playwright/test";
import { toJSONAsync } from "seroval";
import { TEST_ACCOUNTS } from "../src/lib/test-fixtures";

/**
 * Social-login routing matrix, driven by the authoritative backend guard
 * (`getOnboardingStatus` in `src/lib/onboarding.functions.ts`) that
 * `src/routes/__root.tsx` consumes on SIGNED_IN:
 *
 *  1. identity-present  — the auth server reports a linked google/apple
 *     identity (`isSocial: true`) and no account_type → the user MUST land on
 *     `/onboarding/account-type`, with the stashed pending choice and the saved
 *     `next` path preserved for onboarding to consume later.
 *  2. identity-missing  — no linked social identity and no client provider
 *     marker, still no account_type → the user MUST also land on onboarding.
 *  3. identity-present, onboarding already complete → no picker; the saved
 *     `next` path is consumed and the user lands there.
 *
 * Mechanics that matter:
 *  - The sign-in is a REAL one through the /auth form, so the SIGNED_IN event
 *    is emitted by the app's own Supabase client instance. Faking the event
 *    from a test-side dynamic import hits a different module instance and the
 *    root reconcile never runs.
 *  - The guard's server-fn response is stubbed. TanStack encodes those with
 *    seroval and flags them via `x-tss-serialized`; both are reproduced here,
 *    otherwise the client resolves `undefined`, the reconcile throws, and the
 *    test would silently pass on the fallback path.
 */

const player = TEST_ACCOUNTS.find((a) => a.key === "player")!;

test.skip(
  !process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON,
  "Requires seeded Supabase fixture accounts (see e2e/global-setup.ts).",
);

const PENDING_KEY = "openrun.pending_account_type";
const NEXT_KEY = "openrun:oauth-next";
const PROVIDER_KEY = "openrun:oauth-provider";

type Status = {
  needsOnboarding: boolean;
  isSocial: boolean;
  provider: string | null;
  accountType: string | null;
};

async function stubBackend(page: Page, status: Status, opts: { failOnPatch?: boolean } = {}) {
  // Client-side profile fallback used by the route guards.
  await page.route(/\/rest\/v1\/profiles\?.*select=account_type/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([{ account_type: status.accountType }]),
    });
  });

  // A social new-user path must never write the stashed pending type.
  await page.route(/\/rest\/v1\/profiles\?.*id=eq\./, async (route) => {
    if (opts.failOnPatch && route.request().method() === "PATCH") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "unexpected profile PATCH on social sign-in" }),
      });
      return;
    }
    await route.fallback();
  });

  // TanStack server-fn dispatch: the target module/export is base64-encoded in
  // the URL. Only intercept the onboarding guard; everything else falls through.
  await page.route("**/_serverFn/**", async (route) => {
    const seg = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/_serverFn/")[1] ?? "",
    ).split("?")[0];
    let decoded = "";
    try {
      decoded = Buffer.from(seg, "base64").toString("utf8");
    } catch {
      /* not base64 — treat as non-onboarding */
    }
    if (!/onboarding/i.test(decoded)) {
      await route.fallback();
      return;
    }
    const payload = await toJSONAsync({ result: status, error: undefined, context: {} });
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "x-tss-serialized": "true" },
      body: JSON.stringify(payload.t),
    });
  });
}

async function primeStorage(
  page: Page,
  opts: { pending?: string | null; next: string; provider?: "google" | "apple" | null },
) {
  await page.evaluate(
    ([pendingKey, nextKey, providerKey, pending, next, provider]) => {
      if (pending) window.sessionStorage.setItem(pendingKey!, pending);
      else window.sessionStorage.removeItem(pendingKey!);
      window.sessionStorage.setItem(nextKey!, next!);
      if (provider) window.sessionStorage.setItem(providerKey!, provider);
      else window.sessionStorage.removeItem(providerKey!);
    },
    [
      PENDING_KEY,
      NEXT_KEY,
      PROVIDER_KEY,
      opts.pending ?? null,
      opts.next,
      opts.provider ?? null,
    ] as const,
  );
}

/**
 * Real sign-in through the /auth form. `provider` only controls the
 * `openrun:oauth-provider` marker the OAuth buttons stash before leaving the
 * app — the credentials are always the seeded fixture account.
 */
async function signIn(
  page: Page,
  opts: { pending?: string | null; next: string; provider?: "google" | "apple" | null },
) {
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await primeStorage(page, opts);
  await page.getByPlaceholder("Email").fill(player.email);
  await page.getByPlaceholder("Password").fill(player.password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
}

async function readState(page: Page) {
  // A redirect can be mid-flight; retry once the document settles.
  for (let attempt = 0; ; attempt++) {
    try {
      await page.waitForLoadState("domcontentloaded");
      return await page.evaluate(
        ([pendingKey, nextKey, providerKey]) => ({
          pending: window.sessionStorage.getItem(pendingKey!),
          next: window.sessionStorage.getItem(nextKey!),
          provider: window.sessionStorage.getItem(providerKey!),
        }),
        [PENDING_KEY, NEXT_KEY, PROVIDER_KEY] as const,
      );
    } catch (err) {
      if (attempt >= 4) throw err;
      await page.waitForTimeout(500);
    }
  }
}


test.describe("social login: identity-present vs identity-missing", () => {
  for (const provider of ["google", "apple"] as const) {
    test(`identity-present (${provider}): new user lands on onboarding with state preserved`, async ({
      browser,
    }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const NEXT_PATH = `/feed?src=identity-present-${provider}`;
      try {
        await stubBackend(
          page,
          { needsOnboarding: true, isSocial: true, provider, accountType: null },
          { failOnPatch: true },
        );
        await signIn(page, { pending: "player", next: NEXT_PATH, provider });

        await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          timeout: 20_000,
        });

        const state = await readState(page);
        expect(state.pending).toBe("player");
        expect(state.next).toBe(NEXT_PATH);
      } finally {
        await context.close();
      }
    });
  }

  // Identity-missing, per provider: the client stashed a provider marker (the
  // user really did tap Continue with Google/Apple) but the auth server reports
  // no linked social identity. The guard must still force the picker and keep
  // the saved next path for onboarding to consume.
  for (const provider of ["google", "apple"] as const) {
    test(`identity-missing (${provider}): provider marker without a linked identity still routes to onboarding`, async ({
      browser,
    }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const NEXT_PATH = `/feed?src=identity-missing-${provider}`;
      try {
        await stubBackend(
          page,
          { needsOnboarding: true, isSocial: false, provider: null, accountType: null },
          { failOnPatch: true },
        );
        await signIn(page, { pending: null, next: NEXT_PATH, provider });

        await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          timeout: 20_000,
        });

        const state = await readState(page);
        expect(state.pending).toBeNull();
        expect(state.next).toBe(NEXT_PATH);
      } finally {
        await context.close();
      }
    });
  }

  test("identity-missing: no social identity and no account type still routes to onboarding", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const NEXT_PATH = "/feed?src=identity-missing";
    try {
      await stubBackend(
        page,
        { needsOnboarding: true, isSocial: false, provider: null, accountType: null },
        { failOnPatch: true },
      );
      await signIn(page, { pending: null, next: NEXT_PATH, provider: null });

      await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
        timeout: 20_000,
      });

      const state = await readState(page);
      expect(state.pending).toBeNull();
      expect(state.next).toBe(NEXT_PATH);
      expect(state.provider).toBeNull();
    } finally {
      await context.close();
    }
  });


  test("identity-present, onboarding complete: saved next path is consumed", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const NEXT_PATH = "/feed?src=identity-present-complete";
    try {
      await stubBackend(page, {
        needsOnboarding: false,
        isSocial: true,
        provider: "google",
        accountType: "player",
      });
      await signIn(page, { pending: null, next: NEXT_PATH, provider: "google" });

      await expect(page).toHaveURL(/\/feed(?:[?#/].*)?$/, { timeout: 20_000 });
      await expect(page).not.toHaveURL(/\/onboarding\/account-type/);

      // Consumed on success so a later sign-in doesn't re-navigate.
      await expect
        .poll(async () => (await readState(page)).next, { timeout: 10_000 })
        .toBeNull();
      expect((await readState(page)).provider).toBeNull();
    } finally {
      await context.close();
    }
  });
});

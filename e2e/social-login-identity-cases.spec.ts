import { test, expect, type Page } from "@playwright/test";
import { toJSONAsync } from "seroval";


/**
 * Social-login routing matrix, driven by the authoritative backend guard
 * (`getOnboardingStatus` in `src/lib/onboarding.functions.ts`) that
 * `src/routes/__root.tsx` consumes on SIGNED_IN:
 *
 *  1. identity-present  — the auth server reports a linked google/apple
 *     identity (`isSocial: true`) and no account_type → the user MUST land on
 *     `/onboarding/account-type`, with the stashed pending choice and saved
 *     `next` path preserved (the picker is the source of truth; the client
 *     must never PATCH the profile from the stash).
 *  2. identity-missing  — no linked social identity and no client provider
 *     signals (`isSocial: false`) but still no account_type → the user MUST
 *     also land on `/onboarding/account-type`, with the saved `next` preserved.
 *  3. identity-present, onboarding already complete → no picker; the saved
 *     `next` path is consumed and the user lands there.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
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
  await page.route(/\/rest\/v1\/profiles\?.*select=account_type/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([{ account_type: status.accountType }]),
    });
  });

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

  // TanStack server-fn dispatch. The target module/export is base64-encoded in
  // the URL, so decode it and only intercept the onboarding guard; everything
  // else falls through to the real dev server.
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
    // Server-fn responses are seroval-encoded and flagged with
    // `x-tss-serialized` — reproduce both, or the client resolves `undefined`
    // and silently falls back to the client-side profile check. The wire
    // format is the serialized tree only (`.t`), not the toJSONAsync wrapper.
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
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([sbKey, sbValue, pendingKey, nextKey, providerKey, pending, next, provider]) => {
      window.localStorage.setItem(sbKey!, sbValue!);
      if (pending) window.sessionStorage.setItem(pendingKey!, pending);
      else window.sessionStorage.removeItem(pendingKey!);
      window.sessionStorage.setItem(nextKey!, next!);
      if (provider) window.sessionStorage.setItem(providerKey!, provider);
      else window.sessionStorage.removeItem(providerKey!);
    },
    [
      STORAGE_KEY!,
      SESSION_JSON!,
      PENDING_KEY,
      NEXT_KEY,
      PROVIDER_KEY,
      opts.pending ?? null,
      opts.next,
      opts.provider ?? null,
    ] as const,
  );
}

/** Re-emit SIGNED_IN with a patched session so the reconcile branch runs. */
async function emitSignedIn(page: Page, provider: string | null) {
  await page.evaluate(async (providerId) => {
    const mod = await import("/src/integrations/supabase/client.ts");
    const supabase = (mod as { supabase: import("@supabase/supabase-js").SupabaseClient })
      .supabase;
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) throw new Error("no session in test context");
    const appMeta = { ...(session.user.app_metadata ?? {}) };
    if (providerId) appMeta.provider = providerId;
    else delete (appMeta as { provider?: unknown }).provider;
    const patched = { ...session, user: { ...session.user, app_metadata: appMeta } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authAny = supabase.auth as any;
    authAny.getSession = async () => ({ data: { session: patched }, error: null });
    const emit = authAny._notifyAllSubscribers ?? authAny.notifyAllSubscribers;
    if (typeof emit !== "function") throw new Error("Supabase auth emit hook missing");
    await emit.call(supabase.auth, "SIGNED_IN", patched, false);
  }, provider);
}

function readState(page: Page) {
  return page.evaluate(
    ([pendingKey, nextKey, providerKey]) => ({
      pending: window.sessionStorage.getItem(pendingKey!),
      next: window.sessionStorage.getItem(nextKey!),
      provider: window.sessionStorage.getItem(providerKey!),
    }),
    [PENDING_KEY, NEXT_KEY, PROVIDER_KEY] as const,
  );
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
        await primeStorage(page, { pending: "player", next: NEXT_PATH, provider });
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await emitSignedIn(page, provider);

        await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          timeout: 15_000,
        });

        const state = await readState(page);
        expect(state.pending).toBe("player");
        expect(state.next).toBe(NEXT_PATH);
        expect(state.provider).toBe(provider);
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
      // No pending stash and no provider marker: nothing client-side can be
      // used to infer a social sign-in, so the picker must still be reached.
      await primeStorage(page, { pending: null, next: NEXT_PATH, provider: null });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await emitSignedIn(page, null);

      await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
        timeout: 15_000,
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
      await primeStorage(page, { pending: null, next: NEXT_PATH, provider: "google" });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await emitSignedIn(page, "google");

      await expect(page).toHaveURL(/\/feed(?:[?#/].*)?$/, { timeout: 15_000 });
      await expect(page).not.toHaveURL(/\/onboarding\/account-type/);

      const state = await readState(page);
      // Consumed on success so a later sign-in doesn't re-navigate.
      expect(state.next).toBeNull();
      expect(state.provider).toBeNull();
    } finally {
      await context.close();
    }
  });
});

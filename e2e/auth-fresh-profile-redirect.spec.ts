import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: When a signed-in session arrives at /auth, AuthGate MUST route
 * based on the freshest profile row — not a value cached from an earlier
 * visit. We flip `profiles.username` between visits and assert the target
 * route flips with it.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const ACCESS_TOKEN = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

function parseUserId(sessionJson: string): string {
  const { user } = JSON.parse(sessionJson) as { user?: { id?: string } };
  if (!user?.id) throw new Error("Session JSON missing user.id");
  return user.id;
}

function accessTokenFrom(sessionJson: string): string {
  if (ACCESS_TOKEN) return ACCESS_TOKEN;
  const { access_token } = JSON.parse(sessionJson) as { access_token?: string };
  if (!access_token) throw new Error("Session JSON missing access_token");
  return access_token;
}

async function setUsername(userId: string, token: string, username: string | null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_ANON!,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) throw new Error(`PATCH profiles failed: ${res.status} ${await res.text()}`);
}

async function seedSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

test.describe("/auth routing uses freshest profile after session refresh", () => {
  test.skip(
    !SESSION_JSON || !STORAGE_KEY || !SUPABASE_URL || !SUPABASE_ANON,
    "Requires signed-in Supabase session and Supabase env vars.",
  );

  test("flipping profile.username between visits flips the redirect target", async ({
    browser,
  }) => {
    const userId = parseUserId(SESSION_JSON!);
    const token = accessTokenFrom(SESSION_JSON!);
    const restoredUsername = `e2e_${userId.slice(0, 8)}`;

    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      // ---------- Visit 1: no username → /onboarding ----------
      await setUsername(userId, token, null);
      await seedSession(page);
      await page.goto("/auth", { waitUntil: "domcontentloaded" });
      await page.waitForURL((url) => url.pathname === "/onboarding", { timeout: 15_000 });
      expect(new URL(page.url()).pathname).toBe("/onboarding");

      // ---------- Mutate DB, then simulate a session refresh ----------
      // Set username server-side WITHOUT touching the client. If AuthGate
      // used a stale value it would route back to /onboarding.
      await setUsername(userId, token, restoredUsername);

      // Simulate Supabase emitting TOKEN_REFRESHED so AuthGate re-runs its
      // profile lookup against the freshest row. If freshness is broken,
      // the redirect will still land on /onboarding.
      await page.evaluate((sessionJson) => {
        const session = JSON.parse(sessionJson);
        // @ts-expect-error - test-only access to the browser supabase client
        const client = window.supabase ?? null;
        // Fallback to dispatching a storage event that some listeners react to.
        window.dispatchEvent(new StorageEvent("storage", { key: "sb-auth" }));
        if (client?.auth?.refreshSession) {
          void client.auth.refreshSession({ refresh_token: session.refresh_token });
        }
      }, SESSION_JSON!);

      // Navigate back to /auth in the SAME session; AuthGate must re-read
      // the profile and route to /profile now.
      await page.goto("/auth", { waitUntil: "domcontentloaded" });
      await page.waitForURL((url) => url.pathname.startsWith("/profile"), {
        timeout: 15_000,
      });
      expect(new URL(page.url()).pathname).toMatch(/^\/profile/);
    } finally {
      // Idempotent cleanup so re-runs start from a known-good state.
      await setUsername(userId, token, restoredUsername).catch(() => {});
      await ctx.close();
    }
  });
});

/**
 * Answer one TanStack Start server function from the browser side.
 *
 * Server-fn requests go to `/_serverFn/<base64 of {file, export}>`, and the
 * client expects the result serialized with seroval and flagged
 * `x-tss-serialized` — the technique `stubChildStatus` and
 * `child-lifecycle-cohorts.spec.ts` already use. Only the named function is
 * answered; every other server fn falls through to the real server.
 */
import type { Page } from "@playwright/test";
import { toJSONAsync } from "seroval";

/** Which server fn is this `_serverFn` request for? */
export function serverFnId(url: string): string {
  const seg = decodeURIComponent(new URL(url).pathname.split("/_serverFn/")[1] ?? "").split("?")[0];
  try {
    return Buffer.from(seg ?? "", "base64").toString("utf8");
  } catch {
    return seg ?? "";
  }
}

export async function stubServerFn(page: Page, exportName: string, result: unknown) {
  await page.route("**/_serverFn/**", async (route) => {
    if (!serverFnId(route.request().url()).includes(exportName)) {
      await route.fallback();
      return;
    }
    const payload = await toJSONAsync({ result, error: undefined, context: {} });
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "x-tss-serialized": "true" },
      body: JSON.stringify(payload.t),
    });
  });
}

/**
 * Make the signed-in fixture look like a brand-new user with no account type.
 *
 * Stubbing the `profiles?select=account_type` read is not enough: the app asks
 * `getOnboardingStatus` first and only reads the profile itself when that call
 * fails. The server answers from the real fixture profile, which already has a
 * type, so the root SIGNED_IN handler (which also fires when a stored session
 * is restored on page load) sends the "new" user on to the saved `next` path or
 * the feed instead of the account-type picker.
 *
 * `provider` is what the server would find among the user's identities; pass
 * `null` to leave the client-side signals as the only sign of a social login.
 */
export function stubNewUserOnboarding(page: Page, provider: "google" | "apple" | null) {
  return stubServerFn(page, "getOnboardingStatus", {
    needsOnboarding: true,
    isSocial: provider !== null,
    provider,
    accountType: null,
  });
}

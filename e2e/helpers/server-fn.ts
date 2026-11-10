import type { Page } from "@playwright/test";
import { toJSONAsync } from "seroval";

/**
 * TanStack Start server functions are called over `/_serverFn/<id>`, where the
 * id encodes the source file and export name. The response body is a seroval
 * payload. Specs that need a server function to answer a certain way (for
 * example "this member still needs onboarding") stub it here instead of
 * stubbing the table the server reads, which a server-side query never hits.
 */

/** Which server fn is this `_serverFn` request for? The decoded id names the export. */
export function serverFnId(url: string): string {
  const seg = decodeURIComponent(new URL(url).pathname.split("/_serverFn/")[1] ?? "").split("?")[0];
  try {
    return Buffer.from(seg ?? "", "base64").toString("utf8");
  } catch {
    return seg ?? "";
  }
}

/**
 * Answer the server function whose export name matches `exportName` with
 * `result`; every other server function falls through to the real server.
 * Returns the number of calls answered so far via the returned counter object.
 */
export async function stubServerFn(
  page: Page,
  exportName: string | RegExp,
  result: unknown,
): Promise<{ calls: number }> {
  const counter = { calls: 0 };
  const matches =
    typeof exportName === "string"
      ? (id: string) => id.includes(exportName)
      : (id: string) => exportName.test(id);
  await page.route("**/_serverFn/**", async (route) => {
    if (!matches(serverFnId(route.request().url()))) {
      await route.fallback();
      return;
    }
    counter.calls += 1;
    const payload = await toJSONAsync({ result, error: undefined, context: {} });
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "x-tss-serialized": "true" },
      body: JSON.stringify(payload.t),
    });
  });
  return counter;
}

/**
 * What `getOnboardingStatus` answers for a member whose profile holds this
 * `account_type` (null for a brand-new sign-up) and who signed in with this
 * provider. Mirrors `resolveOnboardingStatus` in src/lib/onboarding.functions.ts.
 */
export function onboardingStatusFor(
  accountType: string | null,
  provider: "google" | "apple" | "email" = "google",
) {
  return {
    needsOnboarding: accountType === null,
    isSocial: provider !== "email",
    provider,
    accountType,
  };
}

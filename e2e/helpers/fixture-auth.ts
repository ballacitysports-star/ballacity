/**
 * Shared helpers for the fixture-account E2E specs.
 *
 * The three seeded accounts in `src/lib/test-fixtures.ts` (host, player,
 * player2) exist in the project's live backend. These helpers sign them in
 * through the real `/auth` form — no session injection — so the specs exercise
 * the same code path a member does.
 *
 * `stubChildStatus` narrowly stubs the `getMyChildStatus` server fn so the
 * age-gated surfaces can be walked for every cohort with a real session
 * underneath. Same technique as `child-lifecycle-cohorts.spec.ts`: TanStack
 * encodes server-fn results with seroval and flags them `x-tss-serialized`.
 */
import { expect, type Page } from "@playwright/test";
import { toJSONAsync } from "seroval";
import { TEST_ACCOUNTS, type TestAccountKey } from "../../src/lib/test-fixtures";
import { DEFAULT_AGE_POLICY, DEFAULT_CHILD_CONTROLS } from "../../src/lib/child-policy";

export function account(key: TestAccountKey) {
  const a = TEST_ACCOUNTS.find((x) => x.key === key);
  if (!a) throw new Error(`Unknown fixture account: ${key}`);
  return a;
}

/** Sign in via the real email/password form and wait until we leave /auth. */
export async function signInAs(page: Page, key: TestAccountKey) {
  const a = account(key);
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(a.email);
  await page.getByPlaceholder("Password").fill(a.password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page, `${a.email} should be signed in`).not.toHaveURL(
    /\/auth(?:[?#].*)?$/,
    { timeout: 30_000 },
  );
  return a;
}

export type ConsentStatus = "required" | "pending" | "approved" | "revoked" | "expired";

export type Consent = {
  status: ConsentStatus;
  method: string;
  parentEmail: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  revokedAt: string | null;
  reverifyAt: string | null;
};

export type ChildStatus = {
  cohort: string;
  ageReviewRequired: boolean;
  jurisdiction: string;
  consent: Consent | null;
  controls: typeof DEFAULT_CHILD_CONTROLS | null;
  policy: typeof DEFAULT_AGE_POLICY;
  hasBirthday: boolean;
};

function consentOf(status: ConsentStatus): Consent {
  const now = new Date().toISOString();
  return {
    status,
    method: status === "approved" ? "email_confirmation" : "unverified",
    parentEmail: status === "required" ? null : "guardian@example.com",
    requestedAt: status === "required" ? null : now,
    approvedAt: status === "approved" ? now : null,
    revokedAt: status === "revoked" ? now : null,
    reverifyAt: null,
  };
}

export function childStatus(
  cohort: string,
  consentStatus: ConsentStatus | null,
  extra: Partial<ChildStatus> = {},
): ChildStatus {
  return {
    cohort,
    ageReviewRequired: false,
    jurisdiction: "US_FEDERAL",
    consent: consentStatus ? consentOf(consentStatus) : null,
    controls: consentStatus === "approved" ? DEFAULT_CHILD_CONTROLS : null,
    policy: DEFAULT_AGE_POLICY,
    hasBirthday: true,
    ...extra,
  };
}

/** Which server fn is this `_serverFn` request for? */
function serverFnId(url: string): string {
  const seg = decodeURIComponent(new URL(url).pathname.split("/_serverFn/")[1] ?? "").split("?")[0];
  try {
    return Buffer.from(seg ?? "", "base64").toString("utf8");
  } catch {
    return seg ?? "";
  }
}

/** Stub only `getMyChildStatus`; every other server fn falls through. */
export async function stubChildStatus(page: Page, value: ChildStatus) {
  await page.route("**/_serverFn/**", async (route) => {
    const id = serverFnId(route.request().url());
    if (!/child-safety/i.test(id) || !/MyChildStatus/i.test(id)) {
      await route.fallback();
      return;
    }
    const payload = await toJSONAsync({ result: value, error: undefined, context: {} });
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "x-tss-serialized": "true" },
      body: JSON.stringify(payload.t),
    });
  });
}

/** True when the project has a usable backend connection for E2E runs. */
export const HAS_BACKEND = Boolean(
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL,
);

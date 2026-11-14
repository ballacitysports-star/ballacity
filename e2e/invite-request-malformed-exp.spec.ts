import { expectOnDiscovery } from "./helpers/invite-discovery";
import { fulfillRows } from "./helpers/invite-postgrest";
import { mockRiskNotAcknowledged, watchRiskDialog } from "./helpers/risk-ack";
import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: on an approval-gated game, tapping "Request to join" from an invite
 * deep-link with a malformed `exp` param (non-numeric, negative, zero, NaN)
 * must be blocked — the app shows the expired error state, surfaces a toast,
 * routes safely to the /discover fallback, and never POSTs to
 * /rest/v1/join_requests. The viewer has not acknowledged the game's risks yet,
 * and the refusal comes first: the "Before you join" dialog never opens and no
 * acknowledgment is recorded.
 *
 * Complements `invite-malformed-exp.spec.ts` (which only asserts the banner
 * on a free/no-approval game) by exercising the CTA guard end-to-end on an
 * approval-gated flow with mocked payment settings.
 *
 * Auto-skips without a restored Supabase session.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g2";
const REAL_HOST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

const isTable = (url: string, table: string) => String(url).includes(`/rest/v1/${table}`);

async function installMocks(page: Page, onJoinPost: () => void) {
  await page.route(
    (u) => isTable(u, "game_payment_settings"),
    async (route: PWRoute) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "mock-settings-id",
            game_id: GAME_ID,
            host_id: REAL_HOST_ID,
            entry_fee: 0,
            accepted_method_ids: [],
            payment_deadline: null,
            refund_policy: null,
            payment_instructions: null,
            requires_approval: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]),
      });
    },
  );
  await page.route(
    (u) => isTable(u, "payment_submissions"),
    async (route: PWRoute) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );
  await page.route(
    (u) => isTable(u, "join_requests"),
    async (route: PWRoute) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        return;
      }
      if (method === "POST") {
        onJoinPost();
        await fulfillRows(route, [{ id: "should-not-happen" }], { status: 201 });
        return;
      }
      return route.fallback();
    },
  );
}

const MALFORMED_CASES: Array<{ label: string; expParam: string }> = [
  { label: "non-numeric string", expParam: "not-a-number" },
  { label: "negative timestamp", expParam: "-1" },
  { label: "zero", expParam: "0" },
  { label: "NaN literal", expParam: "NaN" },
];

for (const { label, expParam } of MALFORMED_CASES) {
  test(`malformed exp (${label}) → Request to join is blocked, no join_requests POST`, async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    let joinPostFired = false;
    await installMocks(page, () => {
      joinPostFired = true;
    });
    // The acknowledgment is due, so the dialog would open if the page asked
    // for it before checking the invite's expiry.
    const riskAck = await mockRiskNotAcknowledged(page);
    const riskDialogSeen = await watchRiskDialog(page);
    await restoreSession(page);

    await page.goto(
      `/games/${GAME_ID}?invite=1&from=${REAL_HOST_ID}&exp=${encodeURIComponent(expParam)}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForURL((u) => u.pathname === `/games/${GAME_ID}`, { timeout: 10_000 });

    // Expired error state is what the viewer sees — not the normal invite banner.
    const expired = page.getByTestId("invite-expired-banner");
    await expect(expired).toBeVisible({ timeout: 10_000 });
    await expect(expired).toContainText(/invite expired/i);

    const normalBanner = page
      .getByRole("status")
      .filter({ hasText: /you're invited to this game/i });
    await expect(normalBanner).toHaveCount(0);

    // Sticky "Request to join" CTA still renders on approval-gated games.
    const cta = page.getByRole("button", { name: /request spot/i }).first();
    await expect(cta).toBeVisible({ timeout: 10_000 });
    await cta.click();

    // Guard fires: toast surfaces + navigation to /discover fallback, without
    // the risk dialog opening first.
    const toast = page.getByText(/invite has expired/i).first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    expect(await riskDialogSeen(), "the risk dialog must not open for a refused request").toBe(
      false,
    );
    // /discover redirects to /feed, where discovery lives now.
    await expectOnDiscovery(page);

    // Give any illegitimate POST a chance to land before asserting.
    await page.waitForTimeout(500);
    expect(joinPostFired, "join_requests POST must NOT fire for a malformed-exp invite").toBe(
      false,
    );
    expect(riskAck.writes, "no risk acknowledgment may be recorded for a refused request").toEqual(
      [],
    );

    await ctx.close();
  });
}

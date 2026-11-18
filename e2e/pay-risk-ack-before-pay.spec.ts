import { test, expect, type Page, type Route } from "@playwright/test";
import { restoreSession } from "./helpers/signed-in";
import { PAY_FIXTURE_HOST_ID, payFixtureGameRow, serveFixtureGame } from "./helpers/pay-fixtures";
import { currentSafetyAckVersion, mockRiskNotAcknowledged } from "./helpers/risk-ack";

/**
 * E2E: "Before you join" on the pay page (docs/paid-path-gates.md section 7, Option B, owner decision 2026-11-18).
 *
 * A paid game that needs no host approval sends a player from the game page straight to /games/<id>/pay by a link,
 * and the pay page can be opened directly, so the game page's join tap (which asks the risk acknowledgment) never
 * runs for them. The pay page asks it itself, before any payment option is drawn. This spec serves the acknowledgment
 * as not given (mockRiskNotAcknowledged) to a fresh viewer of a paid open game and checks that:
 *
 *   - the real dialog opens on arrival, and nothing payable (no Venmo or Cash App handle or link, no proof form) is
 *     on the page at any point before the acknowledgment is recorded;
 *   - Cancel closes it, records nothing and writes no payment; the page stays, with no payment options, a way to
 *     open the dialog again and a way back to the game;
 *   - ticking the box and "Agree & join" records exactly one participant_risk acknowledgment for the current version
 *     (the join path's write), and only then are the host's handles shown.
 *
 * The game row, the host's settings and methods, the viewer's request, payments and place, and the guardian check are
 * served, and every acknowledgment or payment write is captured, so nothing depends on, or is written to, the backend.
 *
 * Auto-skips when no signed-in Supabase session is available.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g2";
const HOST_ID = PAY_FIXTURE_HOST_ID;
const ENTRY_FEE = 12;
const VENMO_HANDLE = "e2e-riskack-venmo";
const CASHTAG = "e2eriskackcash";

function sessionUserId(): string {
  const s = JSON.parse(SESSION_JSON!);
  const id: string | undefined = s?.user?.id;
  expect(id, "session must contain user.id").toBeTruthy();
  return id!;
}

const isTable = (url: URL | string, table: string) => String(url).includes(`/rest/v1/${table}`);

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

/** A paid game that needs no approval, two manual methods, and a viewer with no request, payment or place. */
async function mockPaidOpenGame(page: Page): Promise<{ paymentWrites: string[] }> {
  const now = new Date().toISOString();
  const paymentWrites: string[] = [];
  await page.route(
    (u) => isTable(u, "game_payment_settings"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await fulfillJson(route, [
        {
          id: "mock-settings-riskack",
          game_id: GAME_ID,
          host_id: HOST_ID,
          entry_fee: ENTRY_FEE,
          accepted_method_ids: ["mock-venmo", "mock-cashapp"],
          payment_deadline: null,
          refund_policy: null,
          payment_instructions: null,
          requires_approval: false,
          created_at: now,
          updated_at: now,
        },
      ]);
    },
  );
  const method = (over: Record<string, unknown>) => ({
    host_id: HOST_ID,
    payment_url: null,
    contact_info: null,
    instructions: null,
    is_enabled: true,
    created_at: now,
    updated_at: now,
    ...over,
  });
  await page.route(
    (u) =>
      isTable(u, "host_payment_methods") ||
      String(u).includes("/rest/v1/rpc/get_game_host_payment_methods"),
    async (route) => {
      if (!["GET", "POST"].includes(route.request().method())) return route.fallback();
      await fulfillJson(route, [
        method({ id: "mock-venmo", payment_type: "venmo", label: "Venmo", username: VENMO_HANDLE }),
        method({
          id: "mock-cashapp",
          payment_type: "cashapp",
          label: "Cash App",
          username: CASHTAG,
        }),
      ]);
    },
  );
  for (const table of ["join_requests", "game_participants"]) {
    await page.route(
      (u) => isTable(u, table),
      async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        await fulfillJson(route, []);
      },
    );
  }
  // No payment of theirs yet; any payment write is captured, never sent.
  await page.route(
    (u) => isTable(u, "payment_submissions"),
    async (route) => {
      const req = route.request();
      if (req.method() === "GET") return fulfillJson(route, []);
      paymentWrites.push(`${req.method()} ${req.url()}`);
      await route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
    },
  );
  // The guardian check, as the database answers it for an adult.
  await page.route(
    (u) => String(u).includes("/rest/v1/rpc/game_payment_guardian_ready"),
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await fulfillJson(route, true);
    },
  );
  await serveFixtureGame(page, payFixtureGameRow(GAME_ID, { price: ENTRY_FEE }));
  return { paymentWrites };
}

/** Nothing on the page lets money move: no handle, no Venmo or Cash App link, no proof form. */
async function expectNoPaymentOffered(page: Page) {
  await expect(page.getByRole("button", { name: /^pay \$\d+ in venmo$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^pay \$\d+ in cash app$/i })).toHaveCount(0);
  await expect(page.getByText(VENMO_HANDLE)).toHaveCount(0);
  await expect(page.getByText(CASHTAG)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /i have paid/i })).toHaveCount(0);
}

test("a paid open game: the pay page asks 'Before you join' before any payment option; Cancel shows none and writes nothing", async ({
  browser,
}) => {
  const userId = sessionUserId();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const riskAck = await mockRiskNotAcknowledged(page);
  const { paymentWrites } = await mockPaidOpenGame(page);
  // Record whether a handle is ever drawn, however briefly, and how many acknowledgments had been written by then.
  await page.addInitScript(
    ([venmo, cash]) => {
      const w = window as unknown as { __handleSeen?: boolean };
      w.__handleSeen = false;
      new MutationObserver(() => {
        const text = document.body?.innerText ?? "";
        if (text.includes(venmo!) || text.includes(cash!)) w.__handleSeen = true;
      }).observe(document, { childList: true, subtree: true, characterData: true });
    },
    [VENMO_HANDLE, CASHTAG],
  );
  const handleSeen = () =>
    page.evaluate(() => !!(window as unknown as { __handleSeen?: boolean }).__handleSeen);

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  const dialog = page.getByRole("dialog", { name: /before you join/i });
  const checkbox = dialog.getByRole("checkbox");
  const agree = dialog.getByRole("button", { name: /^agree & join$/i });

  // 1. The dialog opens on arrival, unticked, over a page with nothing payable.
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  await expect(agree).toBeDisabled();
  await expectNoPaymentOffered(page);

  // 2. Cancel: the dialog closes, the page stays with no payment options, a way back to the game, and nothing written.
  await dialog.getByRole("button", { name: /^cancel$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 5_000 });
  const card = page.getByTestId("pay-risk-ack-required");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/before you join/i);
  await expect(card.getByRole("link", { name: /back to game/i })).toHaveAttribute(
    "href",
    `/games/${GAME_ID}`,
  );
  expect(new URL(page.url()).pathname).toBe(`/games/${GAME_ID}/pay`);
  await page.waitForTimeout(500);
  await expectNoPaymentOffered(page);
  expect(riskAck.writes, "Cancel must not record an acknowledgment").toEqual([]);
  expect(paymentWrites, "Cancel must not write a payment").toEqual([]);
  expect(await handleSeen(), "no handle was drawn before the acknowledgment").toBe(false);

  // 3. "Review and agree" opens it again, unticked; agreeing records exactly one acknowledgment, then the handles show.
  await card.getByRole("button", { name: /review and agree/i }).click();
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  await checkbox.click();
  await expect(agree).toBeEnabled();
  await agree.click();

  await expect
    .poll(() => riskAck.writes.length, { timeout: 10_000, message: "acknowledgment never sent" })
    .toBe(1);
  expect(riskAck.writes[0]).toMatchObject({
    kind: "participant_risk",
    version: currentSafetyAckVersion(),
    game_id: GAME_ID,
    user_id: userId,
  });
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId("pay-risk-ack-required")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Pay $${ENTRY_FEE} in Venmo` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: `Pay $${ENTRY_FEE} in Cash App` })).toBeVisible();
  await expect(page.getByText(VENMO_HANDLE)).toBeVisible();
  expect(riskAck.writes, "one acknowledgment, not one per render").toHaveLength(1);
  expect(paymentWrites).toEqual([]);

  await ctx.close();
});

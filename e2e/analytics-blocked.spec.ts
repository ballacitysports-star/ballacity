import { expect, test, type Page } from "./helpers/test";
import { BLOCKED_ANALYTICS_HOSTS } from "./safety/analytics-block";

/**
 * Every context this suite opens aborts requests to Google Analytics before they leave
 * the browser: the default one, one a spec creates, and one behind `browser.newPage()`.
 * See e2e/safety/analytics-block.ts.
 */
const urls = BLOCKED_ANALYTICS_HOSTS.flatMap((h) => [
  `https://${h}/`,
  `https://www.${h}/gtag/js?id=G-E2E0000000`,
]);

async function expectBlocked(page: Page) {
  for (const url of urls) {
    await expect(page.goto(url), url).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
  }
}

test("the default context cannot reach Google Analytics", async ({ page }) => {
  await expectBlocked(page);
});

test("a context a spec creates cannot reach Google Analytics", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    await expectBlocked(await context.newPage());
  } finally {
    await context.close();
  }
});

test("a page from browser.newPage() cannot reach Google Analytics", async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await expectBlocked(page);
  } finally {
    await page.context().close();
  }
});

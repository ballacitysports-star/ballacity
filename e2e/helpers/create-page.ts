/**
 * Shared `/create` entry point for the host-name specs.
 *
 * All three host-name-* specs open /create and wait for its "Host a game"
 * heading before they can exercise anything. That wait has been failing in CI
 * with "element(s) not found", and the Playwright trace artifact is not
 * reachable from the environment doing the triage — so the failure was
 * unobservable. This helper dumps what the page actually was at the moment of
 * failure into stdout, which the CI job log does carry.
 *
 * Everything the page could be is distinguishable from that dump: a redirect
 * shows in the URL, a render throw shows as a pageerror plus the root error
 * boundary's copy, a stalled auth gate shows as the loading fallback, and a
 * stalled team lookup shows as the skeleton.
 */
import { expect, type Page } from "@playwright/test";

const HEADING = /host a game/i;
const HEADING_TIMEOUT_MS = 15_000;
const BODY_TEXT_LIMIT = 1500;

/**
 * Open /create and wait for its heading. On failure, print the page's actual
 * state and re-throw the original assertion error.
 */
export async function gotoCreateAndExpectHeading(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  // Registered before navigating so a throw during the first render is caught.
  page.on("pageerror", (err) => {
    pageErrors.push(`${err.name}: ${err.message}\n${err.stack ?? "(no stack)"}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/create");

  try {
    await expect(page.getByRole("heading", { name: HEADING })).toBeVisible({
      timeout: HEADING_TIMEOUT_MS,
    });
  } catch (err) {
    // Best-effort: the page may be in any state, so nothing here may throw and
    // mask the real assertion failure.
    const url = await Promise.resolve(page.url()).catch(() => "(unavailable)");
    const title = await page.title().catch(() => "(unavailable)");
    const bodyText = await page
      .locator("body")
      .innerText()
      .then((t) => t.slice(0, BODY_TEXT_LIMIT))
      .catch(() => "(unavailable)");

    console.log(
      [
        "",
        "===== /create heading not found — page state at failure =====",
        `url:   ${url}`,
        `title: ${title}`,
        "--- body text ---",
        bodyText,
        "--- pageerror events ---",
        pageErrors.length ? pageErrors.join("\n\n") : "(none)",
        "--- console.error events ---",
        consoleErrors.length ? consoleErrors.join("\n") : "(none)",
        "============================================================",
        "",
      ].join("\n"),
    );

    throw err;
  }
}

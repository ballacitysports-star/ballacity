import { test, expect, type Page } from "@playwright/test";

/**
 * No route may be wider than the screen it is on.
 *
 * Horizontal overflow is the failure that makes a page feel broken rather than
 * merely untidy: the whole document scrolls sideways, fixed bars drift, and
 * content sits off-screen with no affordance. It is also easy to reintroduce,
 * since one un-wrapped string or one fixed-width element is enough.
 *
 * So this sweeps the widths the responsive standard names — the common phone,
 * tablet and desktop sizes, plus 320px, where things break first, and 2560px,
 * where a container that forgot to cap itself shows up — and fails with the
 * offending element rather than just a number.
 *
 * Each route is loaded once and then resized, rather than reloaded per width:
 * resizing re-runs layout, which is what is under test, and skipping the boot
 * keeps the sweep quick enough to sit in CI.
 */

const WIDTHS = [320, 375, 390, 430, 768, 820, 1024, 1280, 1440, 1920, 2560];

/** Reachable without a session. */
const PUBLIC_ROUTES = [
  "/",
  "/auth",
  "/terms",
  "/privacy",
  "/safety",
  "/trust-center",
  "/community-guidelines",
  "/contact",
  "/highlights",
  "/reset-password",
];

/** Only reachable with a session; skipped when none was provisioned. */
const AUTHED_ROUTES = [
  "/feed",
  "/players",
  "/teams",
  "/notifications",
  "/profile",
  "/create",
  "/settings",
  "/messages",
  // The account/settings column and the other single-column screens, all now
  // on the page-shell scale. Listed so a width regression on any of them is
  // caught here rather than on someone's phone.
  "/account/privacy",
  "/account/notifications",
  "/account/data",
  "/account/security",
  "/account/legal",
  "/account/blocked",
  "/account/ai-privacy",
  "/profile/edit",
  "/parent",
  "/payments",
  "/reviews",
  "/orgs",
];

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

/**
 * Measure overflow and name what caused it.
 *
 * Elements inside a container that scrolls or clips horizontally are excluded:
 * a carousel or a wide table in its own scroller is deliberate, and only
 * overflow that reaches the document counts as a defect.
 */
async function findOverflow(page: Page) {
  return page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    if (overflow <= 1) return { overflow: 0, culprits: [] as string[] };

    const culprits: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= window.innerWidth + 1) continue;

      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const overflowX = getComputedStyle(p).overflowX;
        if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;

      const classes = (el.className?.toString?.() ?? "").split(" ").slice(0, 3).join(".");
      culprits.push(
        `${el.tagName.toLowerCase()}${classes ? `.${classes}` : ""} → ${Math.round(rect.right)}px`,
      );
      if (culprits.length >= 3) break;
    }
    return { overflow, culprits };
  });
}

async function sweep(page: Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  // A route that bounces (a guard, a missing account type) would otherwise
  // measure whatever it landed on and report a confident pass for a page it
  // never opened. Say so instead of quietly testing the wrong thing.
  const landed = new URL(page.url()).pathname;
  if (landed !== route && landed !== `${route}/`) {
    test.info().annotations.push({
      type: "redirected",
      description: `${route} redirected to ${landed}; measuring that instead.`,
    });
  }
  // Let the app mount so the real layout is measured, not the loading shell.
  //
  // This used to swallow the timeout, on the reasoning that a route which
  // never sets the flag is still worth measuring. It is not: a page whose
  // client never hydrated has almost no content, and an empty page cannot
  // overflow, so scrollWidth === clientWidth at every width and the sweep
  // reports a confident pass for a page that never rendered. Observed for
  // real — a stale Vite dep cache stopped the client booting, and every
  // route still "passed". A failure to boot has to fail the test, or this
  // whole spec quietly becomes a no-op the day the app stops loading.
  const booted = await page
    .waitForFunction(() => (window as { __openrun_booted?: boolean }).__openrun_booted === true, {
      timeout: 20_000,
    })
    .then(() => true)
    .catch(() => false);
  if (!booted) {
    const text = (await page.evaluate(() => document.body.innerText || "")).trim();
    expect(
      booted,
      `${route} never finished booting, so there is nothing to measure. ` +
        `Body text was ${text.length} chars: ${JSON.stringify(text.slice(0, 200))}`,
    ).toBe(true);
  }

  const failures: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    // One frame for layout plus any width-driven re-render to settle.
    await page.waitForTimeout(250);
    const { overflow, culprits } = await findOverflow(page);
    if (overflow > 1) {
      failures.push(
        `${width}px: +${overflow}px — ${culprits.join(", ") || "(no element isolated)"}`,
      );
    }
  }
  expect(failures, `${route} overflows horizontally:\n  ${failures.join("\n  ")}`).toEqual([]);
}

test.describe("no horizontal overflow", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} fits every viewport width`, async ({ page }) => {
      await sweep(page, route);
    });
  }
});

test.describe("no horizontal overflow (signed in)", () => {
  test.skip(
    !SESSION_JSON || !STORAGE_KEY,
    "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
  );

  for (const route of AUTHED_ROUTES) {
    test(`${route} fits every viewport width`, async ({ page }) => {
      await restoreSession(page);
      await sweep(page, route);
    });
  }
});

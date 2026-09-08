import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Resolve a browser that actually exists on this machine.
 *
 * Order:
 *  1. explicit PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH (empty string = "use
 *     Playwright's own managed browser", as CI sets it)
 *  2. known sandbox install locations
 *  3. undefined → Playwright's managed Chromium
 */
function resolveChromium(): string | undefined {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (typeof fromEnv === "string") {
    if (fromEnv.trim() === "") return undefined;
    return existsSync(fromEnv) ? fromEnv : undefined;
  }
  const candidates = [
    "/opt/ms-playwright/chromium-1194/chrome-linux/chrome",
    "/chromium-1194/chrome-linux/chrome",
  ];
  return candidates.find((p) => existsSync(p));
}


/**
 * Playwright config for E2E tests against the local dev server.
 *
 * Run with:
 *   bun run dev            # in one shell
 *   bunx playwright test   # in another
 *
 * The host-name test under `e2e/` expects the user's Supabase session to be
 * available via the `LOVABLE_BROWSER_SUPABASE_*` env vars (auto-injected in
 * the Lovable sandbox; see `browser-use` docs). When those vars are missing
 * the spec auto-skips so CI without credentials still passes.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  // The list reporter writes its tally to stdout at the very end, and twice now
  // that tally has not survived: runs 70 and 71 both stop after the last
  // failure block with no "N failed"/"N passed" line at all, while run 68 —
  // same config — printed it. Exit code 1 was preserved both times, so the
  // process knew it had failed; only the summary was lost.
  //
  // That makes CI unreadable in exactly the case you need to read it. A JSON
  // reporter writing to a file does not depend on stdout being flushed at
  // exit, so the counts survive whatever is truncating the tail, and the
  // workflow prints them from there.
  reporter: process.env.CI
    ? ([["list"], ["json", { outputFile: "playwright-report/results.json" }]] as const)
    : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    viewport: { width: 1280, height: 1800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: resolveChromium(),
    },

  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

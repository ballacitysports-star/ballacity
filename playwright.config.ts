import { defineConfig, devices } from "@playwright/test";

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
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    viewport: { width: 1280, height: 1800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
        "/chromium-1194/chrome-linux/chrome",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

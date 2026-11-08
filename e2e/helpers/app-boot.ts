import { expect, type Page } from "@playwright/test";

/**
 * Wait until the app is mounted on the page a simulated OAuth return lands on,
 * so a SIGNED_IN emitted next is heard.
 *
 * Two things used to swallow the event these specs emit:
 *  - RootComponent subscribes to Supabase auth events in the same effect that
 *    calls `markAppBooted()` (src/routes/__root.tsx), which sets
 *    `window.__openrun_booted`. An event emitted right after
 *    `goto(..., { waitUntil: "domcontentloaded" })` reached no listener.
 *  - A signed-in visitor to /auth is sent on with a hard reload
 *    (`goPostAuth` → `window.location.replace` in src/routes/auth.tsx). An
 *    event emitted on /auth was lost with that document, or the evaluate
 *    failed with "Execution context was destroyed". A real OAuth return
 *    lands on the app, not on /auth, so wait for that hand-off first.
 *  - The landing page `/` sends a signed-in member on to their last page or
 *    /feed right after boot. A reconcile that navigated before that redirect
 *    was overridden by it, so `/` counts as in transit too.
 *
 * Polls, so it survives the reload in between.
 */
export async function waitForAppToSettle(page: Page) {
  await expect
    .poll(
      () =>
        page
          .evaluate(
            () =>
              (window as unknown as { __openrun_booted?: boolean }).__openrun_booted === true &&
              window.location.pathname !== "/auth" &&
              window.location.pathname !== "/",
          )
          .catch(() => false),
      { timeout: 20_000, message: "app never booted off /auth and /" },
    )
    .toBe(true);
}

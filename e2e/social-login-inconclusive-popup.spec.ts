import { test, expect } from "@playwright/test";

/**
 * iPhone Safari freezes the opener tab as soon as the user switches to the
 * provider tab, so the OAuth helper's popup-closed watcher rejects with
 * "Sign in was cancelled" while the sign-in is still in progress. That signal
 * is NOT proof of failure: /auth must show a calm waiting state and keep
 * polling for a session instead of surfacing an error toast.
 *
 * Reproduction mechanics:
 *  - The helper only opens a popup when the app is framed (otherwise it does a
 *    full-page redirect), so /auth is loaded inside a same-origin iframe.
 *  - `window.open` is stubbed to return a window that reports itself closed,
 *    which is exactly what iOS Safari does to the frozen opener.
 */
test("inconclusive popup close shows a waiting state, not an error", async ({ page }) => {
  await page.addInitScript(() => {
    // Mimic a popup the browser immediately reports as closed.
    window.open = () =>
      ({
        closed: true,
        close() {},
        focus() {},
        postMessage() {},
        location: { href: "" },
      }) as unknown as Window;
  });

  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.setContent(
    `<iframe id="app" src="/auth" style="width:420px;height:900px;border:0"></iframe>`,
  );

  const frame = page.frameLocator("#app");
  const googleButton = frame.getByRole("button", { name: /Continue with Google/i });
  await expect(googleButton).toBeVisible();
  await googleButton.click();

  // Calm waiting state, and the button reflects that work is still in flight.
  await expect(frame.getByText(/Waiting for Google to finish/i)).toBeVisible({
    timeout: 15000,
  });
  await expect(frame.getByRole("button", { name: /Finishing sign-in/i })).toBeVisible();

  // No scary error surfaced for the ambiguous signal.
  await expect(frame.getByText(/was cancelled/i)).toHaveCount(0);
  await expect(frame.getByText(/popup was blocked/i)).toHaveCount(0);
});

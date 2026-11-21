/**
 * The sticky "Request Spot" button on an approval-gated game, for the invite
 * specs that tap it more than once.
 *
 * The game page flips that button to "Request pending · Tap to cancel" the
 * moment the request is sent (an optimistic row), and keeps it disabled until
 * the server answers. A locator by the "Request Spot" name alone stops matching
 * after the first tap, so a second `click()` waits for the name to come back
 * and lands only after the first request has settled, which is not a tap made
 * while it is in flight. This locator follows the same button through both
 * labels.
 */
import type { Locator, Page } from "@playwright/test";

export function stickyRequestCta(page: Page): Locator {
  return page.getByRole("button", { name: /^(request spot|request pending)/i }).first();
}

/**
 * Opening a payment app's web link (Venmo, Cash App, PayPal.me) from the pay
 * screen.
 *
 * The player pays in a new tab and comes back to this one to send proof, so
 * this tab must stay on the pay screen. Only when the browser refuses the new
 * tab (a popup blocker, some in-app browsers) does this tab go to the link
 * instead.
 *
 * It used to call `window.open(url, "_blank", "noopener,noreferrer")` and treat
 * a null result as "blocked". But a browser always returns null from
 * `window.open` when "noopener" (or "noreferrer", which implies it) is
 * requested, even when the tab opened. So every tap opened the payment app in
 * a new tab AND sent this tab to it as well, taking the player off the proof
 * form they were told to come back to.
 *
 * So open the tab without the feature, which makes null mean what the fallback
 * assumes, and cut the new tab's link back to this page (`opener = null`)
 * before it has loaded anything, which is what "noopener" was there for.
 */
type Opener = {
  open: (url: string, target: string) => { opener: unknown } | null;
  location: { assign: (url: string) => void };
};

export function openExternalPaymentTab(
  url: string,
  win: Opener = window as unknown as Opener,
): "new-tab" | "this-tab" {
  const tab = win.open(url, "_blank");
  if (tab) {
    try {
      tab.opener = null;
    } catch {
      /* some browsers make opener read-only for a cross-origin tab; it has none then */
    }
    return "new-tab";
  }
  win.location.assign(url);
  return "this-tab";
}

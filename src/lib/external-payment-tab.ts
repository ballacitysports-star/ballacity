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
 * So the tab is opened empty and without either feature, which makes null mean
 * what the fallback assumes. Then, before it loads anything, its link back to
 * this page is cut (`opener = null`, what "noopener" was for), and it is sent
 * to the payment link by a `rel="noreferrer"` link clicked inside it, so the
 * payment site gets no Referer naming BallaCity (what "noreferrer" was for).
 * The fallback in this tab follows such a link too.
 *
 * Checked in Chromium: the new tab reaches the link with no Referer and no
 * opener, this tab stays put, and the result is "new-tab".
 */
type LinkDocument = {
  createElement: (tag: "a") => {
    href: string;
    rel: string;
    click: () => void;
    remove: () => void;
  };
  body: { appendChild: (node: never) => unknown } | null;
};

type Opener = {
  open: (
    url: string,
    target: string,
  ) => {
    opener: unknown;
    document: LinkDocument;
    location: { replace: (url: string) => void };
  } | null;
  document: LinkDocument;
};

/** Navigate `doc`'s window to `url` without sending a Referer. */
function followWithoutReferrer(doc: LinkDocument, url: string) {
  const a = doc.createElement("a");
  a.href = url;
  a.rel = "noreferrer";
  doc.body?.appendChild(a as never);
  a.click();
  a.remove();
}

/**
 * Only web links may be followed. For an "other" method the link is whatever
 * the host typed, and a `javascript:` or `data:` URL would run with this site's
 * origin (the empty tab shares it, and so does this one on the fallback path),
 * where the player's session lives.
 */
export function isSafePaymentLink(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function openExternalPaymentTab(
  url: string,
  win: Opener = window as unknown as Opener,
): "new-tab" | "this-tab" | "refused" {
  if (!isSafePaymentLink(url)) return "refused";
  // An empty tab: the payment link must not load before opener is cut.
  const tab = win.open("", "_blank");
  if (!tab) {
    followWithoutReferrer(win.document, url);
    return "this-tab";
  }
  try {
    tab.opener = null;
  } catch {
    /* some browsers make opener read-only; then it is already null */
  }
  try {
    followWithoutReferrer(tab.document, url);
  } catch {
    // The empty tab's document is out of reach (it should share this page's
    // origin). Still take it to the link, Referer or not, not leave it blank.
    tab.location.replace(url);
  }
  return "new-tab";
}

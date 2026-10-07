// Thin wrapper around the gtag.js tag installed in __root. Safe on the server
// and when the tag is absent (no-op). Never send personal data (emails, names).
type Gtag = (...args: unknown[]) => void;

export function trackEvent(name: string, params: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const gtag = (window as unknown as { gtag?: Gtag }).gtag;
  if (typeof gtag !== "function") return;
  try {
    gtag("event", name, params);
  } catch {
    // analytics must never break the app
  }
}

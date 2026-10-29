// Funnel analytics through the gtag.js tag. Rules, all enforced here so a call
// site cannot get them wrong:
//   * Adults only. Nothing is sent, and the tag is not even loaded, until the
//     app has confirmed the signed-in member is an adult (`setAnalyticsAudience`).
//     Minors, signed-out visitors and members whose age is unknown send nothing.
//   * Only the events listed below, with primitive parameters. Anything that
//     looks like personal data is dropped.
//   * Safe on the server, without a tag, and when the tag throws.
type Gtag = (...args: unknown[]) => void;

/** The funnel. Add a name here before sending it. */
export const ANALYTICS_EVENTS = [
  "sign_up", // first adult session of a new account
  "select_role",
  "view_game",
  "join_game", // a join that went through (instant join or request sent)
  "create_game",
  "onboarding_complete", // the profile setup was finished, not skipped
  "view_listing", // a team, trainer or facility page was opened (kind only)
  "create_listing", // a team, trainer or facility was published (kind only)
  "cancel_game", // a host cancelled their game
  "leave_game", // a player took themselves off a game
  "task_error", // an important task failed (task name only, never the message)
  "view_sport_hub", // a public sport hub was opened (sport only)
  "select_primary_sport", // a member chose which sport comes first (sport only)
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** The tasks a `task_error` can name. Anything else is dropped, so no free text leaves. */
export const ANALYTICS_TASKS = ["publish_game", "request_to_join", "cancel_game"] as const;
export type AnalyticsTask = (typeof ANALYTICS_TASKS)[number];

const PII_KEY = /mail|name|phone|address|birth|user|token|password|lat|lng|lon/i;
const MAX_QUEUED = 20;

let adultAudience = false;
const queue: { name: AnalyticsEvent; params: Record<string, string | number | boolean> }[] = [];

/** Primitive values only, and nothing whose key or value looks personal. */
export function sanitizeParams(
  params: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (PII_KEY.test(key)) continue;
    if (typeof value === "string") {
      if (value.includes("@") || value.length > 100) continue;
      out[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

function send(name: AnalyticsEvent, params: Record<string, string | number | boolean>) {
  const gtag = (window as unknown as { gtag?: Gtag }).gtag;
  if (typeof gtag !== "function") return;
  try {
    gtag("event", name, params);
  } catch {
    // analytics must never break the app
  }
}

export function trackEvent(name: AnalyticsEvent, params: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  if (!(ANALYTICS_EVENTS as readonly string[]).includes(name)) return;
  const clean = sanitizeParams(params);
  if (adultAudience) {
    send(name, clean);
    return;
  }
  // Not yet known to be an adult: hold a few events for the moment that is
  // confirmed, and drop them if it never is.
  if (queue.length < MAX_QUEUED) queue.push({ name, params: clean });
}

/** A failed important task, by name only: no error text, no ids. */
export function trackTaskError(task: AnalyticsTask) {
  if (!(ANALYTICS_TASKS as readonly string[]).includes(task)) return;
  trackEvent("task_error", { task });
}

/** Called once the member's age is known. Anything but `true` also discards held events. */
export function setAnalyticsAudience(isAdult: boolean) {
  adultAudience = isAdult;
  if (!isAdult) {
    queue.length = 0;
    return;
  }
  while (queue.length) {
    const e = queue.shift()!;
    send(e.name, e.params);
  }
}

/** Inject the tag, once. A no-op without a measurement id or on the server. */
export function loadAnalyticsTag(measurementId: string) {
  if (typeof window === "undefined" || !measurementId) return;
  const w = window as unknown as { gtag?: Gtag; dataLayer?: unknown[]; __bcGaLoaded?: boolean };
  if (w.__bcGaLoaded) return;
  w.__bcGaLoaded = true;
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() {
    // gtag.js reads the `arguments` object, not an array.
    // eslint-disable-next-line prefer-rest-params
    (w.dataLayer as unknown[]).push(arguments);
  };
  w.gtag("js", new Date());
  // No advertising features or ad personalization signals.
  w.gtag("config", measurementId, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(s);
}

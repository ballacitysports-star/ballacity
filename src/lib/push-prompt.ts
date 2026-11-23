/**
 * WP 4.0: what the Alerts tab tells a member about push on this device. Members get one plain prompt; the
 * delivery diagnostics ("Push delivery issue") are for superadmins only. Pure, so the rules are tested apart
 * from the browser and OneSignal.
 */

export type PushPermission = "granted" | "denied" | "default" | "unsupported";
export type DevicePushSubscription = "subscribed" | "not_subscribed" | "unknown";

/**
 * "enable": offer "Turn on push notifications". "blocked": explain how to allow them. "home_screen" (WP 5.4): an iPhone or
 * iPad browser tab, where push does not exist until BallaCity is added to the Home Screen; explain how. null: say nothing.
 */
export type MemberPushPrompt = "enable" | "blocked" | "home_screen" | null;

export function memberPushPrompt(input: {
  permission: PushPermission;
  device: DevicePushSubscription;
  dismissed: boolean;
  /** A managed child acts on the guardian's device, which must stay subscribed as the guardian. */
  managed: boolean;
  /** An iPhone or iPad browser tab, not the app opened from the Home Screen (isIosBrowserTab). */
  iosBrowserTab?: boolean;
}): MemberPushPrompt {
  const { permission, device, dismissed, managed, iosBrowserTab = false } = input;
  // A managed child is on the guardian's device: whatever the browser permission, turning push on here would
  // opt that device in outside the guardian's own sign-in, so the child is never asked (nor told it is blocked).
  if (managed || dismissed) return null;
  // iOS offers web push only to a site added to the Home Screen; in a Safari (or other iOS browser) tab the
  // Notification API is missing. Elsewhere "unsupported" has no fix we can offer, so say nothing.
  if (permission === "unsupported") return iosBrowserTab ? "home_screen" : null;
  if (permission === "denied") return "blocked";
  if (permission === "default") return "enable";
  // Allowed in the browser, but this device has no push subscription, so closed-app alerts can't arrive.
  // "unknown" (the SDK is still loading) is not a reason to nag.
  if (device === "not_subscribed") return "enable";
  return null;
}

/** Wording for the prompt: no provider or technical terms. */
export const MEMBER_PUSH_COPY = {
  enableTitle: "Turn on push notifications",
  enableBody:
    "Get an alert on this device when a host answers your request or a game changes, even when BallaCity is closed.",
  enableButton: "Turn on",
  blockedTitle: "Push notifications are blocked",
  blockedBody:
    "To get alerts on this device, allow notifications for BallaCity in your browser or phone settings.",
  enabled: "Push notifications are on for this device.",
  blockedToast:
    "Notifications are blocked. Allow them for BallaCity in your browser or phone settings.",
  failed: "Couldn't turn on push notifications on this device. Please try again.",
  homeScreenTitle: "Get alerts on your iPhone",
  homeScreenBody:
    "On iPhone and iPad, alerts work once BallaCity is on your Home Screen. Tap Share, choose Add to Home Screen, then open BallaCity from your Home Screen and turn on notifications.",
} as const;

/**
 * Whether this is an iPhone or iPad browser tab rather than BallaCity opened from the Home Screen. iPadOS reports itself
 * as a Mac, so a Mac with a touch screen counts as an iPad (the rule PwaInstallPrompt uses).
 */
export function isIosBrowserTab(env: {
  userAgent: string;
  maxTouchPoints: number;
  /** display-mode: standalone, or navigator.standalone: opened from the Home Screen. */
  standalone: boolean;
}): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(env.userAgent) ||
    (env.userAgent.includes("Macintosh") && env.maxTouchPoints > 1);
  return ios && !env.standalone;
}

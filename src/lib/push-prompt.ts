/**
 * WP 4.0: what the Alerts tab tells a member about push on this device. Members get one plain prompt; the
 * delivery diagnostics ("Push delivery issue") are for superadmins only. Pure, so the rules are tested apart
 * from the browser and OneSignal.
 */

export type PushPermission = "granted" | "denied" | "default" | "unsupported";
export type DevicePushSubscription = "subscribed" | "not_subscribed" | "unknown";

/** "enable": offer "Turn on push notifications". "blocked": explain how to allow them. null: say nothing. */
export type MemberPushPrompt = "enable" | "blocked" | null;

export function memberPushPrompt(input: {
  permission: PushPermission;
  device: DevicePushSubscription;
  dismissed: boolean;
  /** A managed child acts on the guardian's device, which must stay subscribed as the guardian. */
  managed: boolean;
}): MemberPushPrompt {
  const { permission, device, dismissed, managed } = input;
  // A managed child is on the guardian's device: whatever the browser permission, turning push on here would
  // opt that device in outside the guardian's own sign-in, so the child is never asked (nor told it is blocked).
  if (managed) return null;
  if (permission === "unsupported" || dismissed) return null;
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
} as const;

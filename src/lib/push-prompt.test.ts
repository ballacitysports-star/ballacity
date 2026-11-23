import { describe, expect, it } from "vitest";
import { MEMBER_PUSH_COPY, isIosBrowserTab, memberPushPrompt } from "./push-prompt";

const base = { device: "unknown", dismissed: false, managed: false } as const;

describe("memberPushPrompt", () => {
  it("offers to turn push on before the browser has been asked", () => {
    expect(memberPushPrompt({ ...base, permission: "default" })).toBe("enable");
  });

  it("explains how to allow push when the browser blocks it", () => {
    expect(memberPushPrompt({ ...base, permission: "denied" })).toBe("blocked");
  });

  it("offers to turn push on when allowed but this device has no subscription", () => {
    expect(memberPushPrompt({ ...base, permission: "granted", device: "not_subscribed" })).toBe(
      "enable",
    );
  });

  it("says nothing once this device is subscribed, or while the push SDK is still loading", () => {
    expect(memberPushPrompt({ ...base, permission: "granted", device: "subscribed" })).toBeNull();
    expect(memberPushPrompt({ ...base, permission: "granted", device: "unknown" })).toBeNull();
  });

  it("says nothing when push is unsupported or the member dismissed the prompt", () => {
    expect(memberPushPrompt({ ...base, permission: "unsupported" })).toBeNull();
    expect(memberPushPrompt({ ...base, permission: "default", dismissed: true })).toBeNull();
    expect(memberPushPrompt({ ...base, permission: "denied", dismissed: true })).toBeNull();
  });

  it("never asks a managed child to subscribe the guardian's device, whatever the permission", () => {
    expect(
      memberPushPrompt({ ...base, permission: "granted", device: "not_subscribed", managed: true }),
    ).toBeNull();
    expect(memberPushPrompt({ ...base, permission: "default", managed: true })).toBeNull();
    expect(memberPushPrompt({ ...base, permission: "denied", managed: true })).toBeNull();
  });

  it("shows Add to Home Screen guidance instead of nothing in an iPhone or iPad browser tab (WP 5.4)", () => {
    expect(memberPushPrompt({ ...base, permission: "unsupported", iosBrowserTab: true })).toBe(
      "home_screen",
    );
    // Not on iOS: "unsupported" has no fix to offer.
    expect(
      memberPushPrompt({ ...base, permission: "unsupported", iosBrowserTab: false }),
    ).toBeNull();
    // Dismissed, or a managed child on the guardian's device: still nothing.
    expect(
      memberPushPrompt({
        ...base,
        permission: "unsupported",
        iosBrowserTab: true,
        dismissed: true,
      }),
    ).toBeNull();
    expect(
      memberPushPrompt({ ...base, permission: "unsupported", iosBrowserTab: true, managed: true }),
    ).toBeNull();
    // On the Home Screen push exists, and the usual prompts apply.
    expect(memberPushPrompt({ ...base, permission: "default", iosBrowserTab: true })).toBe(
      "enable",
    );
    expect(MEMBER_PUSH_COPY.homeScreenBody).toMatch(/Add to Home Screen/);
  });

  it("tells an iPhone or iPad browser tab from the Home Screen app and from other devices", () => {
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    const ipad =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15";
    const android =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
    expect(isIosBrowserTab({ userAgent: iphone, maxTouchPoints: 5, standalone: false })).toBe(true);
    expect(isIosBrowserTab({ userAgent: ipad, maxTouchPoints: 5, standalone: false })).toBe(true);
    expect(isIosBrowserTab({ userAgent: iphone, maxTouchPoints: 5, standalone: true })).toBe(false);
    expect(isIosBrowserTab({ userAgent: ipad, maxTouchPoints: 0, standalone: false })).toBe(false);
    expect(isIosBrowserTab({ userAgent: android, maxTouchPoints: 5, standalone: false })).toBe(
      false,
    );
  });

  it("words the prompt without provider or technical terms", () => {
    const text = Object.values(MEMBER_PUSH_COPY).join(" ");
    expect(text).not.toMatch(/onesignal|provider|subscri|token|error|delivery/i);
    expect(MEMBER_PUSH_COPY.enableTitle).toBe("Turn on push notifications");
  });
});

import { describe, expect, it } from "vitest";
import { MEMBER_PUSH_COPY, memberPushPrompt } from "./push-prompt";

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

  it("words the prompt without provider or technical terms", () => {
    const text = Object.values(MEMBER_PUSH_COPY).join(" ");
    expect(text).not.toMatch(/onesignal|provider|subscri|token|error|delivery/i);
    expect(MEMBER_PUSH_COPY.enableTitle).toBe("Turn on push notifications");
  });
});

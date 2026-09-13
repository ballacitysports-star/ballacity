import { describe, it, expect } from "vitest";
import { toAppPath, resolveNotificationTarget, toAbsoluteDeepLink } from "@/lib/deep-links";
describe("deep links", () => {
  it("keeps app paths", () => expect(toAppPath("/games/1?invite=1")).toBe("/games/1?invite=1"));
  it("rejects external", () => expect(toAppPath("https://evil.com/x")).toBe(null));
  it("rejects schemes", () => expect(toAppPath("javascript:alert(1)")).toBe(null));
  it("falls back by type", () =>
    expect(resolveNotificationTarget({ type: "message" })).toBe("/messages"));
  it("absolutizes", () =>
    expect(toAbsoluteDeepLink("/messages/5", "message", "https://a.b")).toBe(
      "https://a.b/messages/5",
    ));
});

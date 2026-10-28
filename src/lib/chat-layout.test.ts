import { describe, expect, it } from "vitest";
import { isChatThreadPath } from "./chat-layout";

describe("isChatThreadPath", () => {
  it("is true for one conversation, with or without a trailing slash", () => {
    expect(isChatThreadPath("/messages/6f1c2d3e-0000-4000-8000-123456789abc")).toBe(true);
    expect(isChatThreadPath("/messages/abc/")).toBe(true);
  });
  it("is false for the inbox and everything else", () => {
    for (const p of ["/messages", "/messages/", "/feed", "/messages/abc/info", "/"]) {
      expect(isChatThreadPath(p)).toBe(false);
    }
  });
});

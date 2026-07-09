/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  consumePostAuthRedirect,
  isSafeRedirectPath,
  peekPostAuthRedirect,
  savePostAuthRedirect,
  clearPostAuthRedirect,
} from "./post-auth-redirect";

beforeEach(() => {
  sessionStorage.clear();
});

describe("isSafeRedirectPath", () => {
  it("accepts same-origin relative paths", () => {
    expect(isSafeRedirectPath("/profile")).toBe(true);
    expect(isSafeRedirectPath("/games/abc-123")).toBe(true);
    expect(isSafeRedirectPath("/profile?tab=games")).toBe(true);
  });

  it("rejects non-strings and empties", () => {
    expect(isSafeRedirectPath(null)).toBe(false);
    expect(isSafeRedirectPath(undefined)).toBe(false);
    expect(isSafeRedirectPath("")).toBe(false);
    expect(isSafeRedirectPath(42)).toBe(false);
  });

  it("rejects protocol-relative and absolute URLs", () => {
    expect(isSafeRedirectPath("//evil.com/x")).toBe(false);
    expect(isSafeRedirectPath("https://evil.com/x")).toBe(false);
    expect(isSafeRedirectPath("/\\evil.com")).toBe(false);
    expect(isSafeRedirectPath("profile")).toBe(false); // no leading slash
  });

  it("rejects auth-loop-producing paths", () => {
    expect(isSafeRedirectPath("/")).toBe(false);
    expect(isSafeRedirectPath("/index")).toBe(false);
    expect(isSafeRedirectPath("/index?from=preview")).toBe(false);
    expect(isSafeRedirectPath("/auth")).toBe(false);
    expect(isSafeRedirectPath("/auth/anything")).toBe(false);
    expect(isSafeRedirectPath("/oauth/callback")).toBe(false);
    expect(isSafeRedirectPath("/reset-password")).toBe(false);
  });

  it("rejects overlong paths", () => {
    expect(isSafeRedirectPath("/" + "a".repeat(600))).toBe(false);
  });
});

describe("save/peek/consume", () => {
  it("round-trips a safe path", () => {
    savePostAuthRedirect("/games/xyz");
    expect(peekPostAuthRedirect()).toBe("/games/xyz");
    expect(consumePostAuthRedirect("/profile")).toBe("/games/xyz");
    expect(peekPostAuthRedirect()).toBe(null);
  });

  it("consume returns fallback when nothing saved", () => {
    expect(consumePostAuthRedirect("/profile")).toBe("/profile");
  });

  it("consume ignores an unsafe stored value", () => {
    sessionStorage.setItem("openrun:postAuthRedirect", "https://evil.com");
    expect(consumePostAuthRedirect("/profile")).toBe("/profile");
  });

  it("save silently drops unsafe paths", () => {
    savePostAuthRedirect("//evil.com");
    expect(peekPostAuthRedirect()).toBe(null);
  });

  it("clear removes the stored value", () => {
    savePostAuthRedirect("/games/xyz");
    clearPostAuthRedirect();
    expect(peekPostAuthRedirect()).toBe(null);
  });
});

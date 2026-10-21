// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRememberedVisibility,
  isProfileHidden,
  readRememberedVisibility,
  rememberVisibility,
  visibilityAfterShow,
} from "./profile-visibility";

describe("isProfileHidden", () => {
  it("is hidden only when visibility is Only me", () => {
    expect(isProfileHidden("private")).toBe(true);
    expect(isProfileHidden("members")).toBe(false);
    expect(isProfileHidden("public")).toBe(false);
  });
});

describe("visibilityAfterShow", () => {
  it("restores signed-in members", () => {
    expect(visibilityAfterShow("members")).toBe("members");
  });

  it("defaults to Everyone when nothing useful was remembered", () => {
    expect(visibilityAfterShow("public")).toBe("public");
    expect(visibilityAfterShow(null)).toBe("public");
    expect(visibilityAfterShow(undefined)).toBe("public");
    expect(visibilityAfterShow("nonsense")).toBe("public");
  });

  it("never restores to Only me", () => {
    expect(visibilityAfterShow("private")).toBe("public");
  });
});

describe("remembered visibility", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips per user", () => {
    rememberVisibility("u1", "members");
    expect(readRememberedVisibility("u1")).toBe("members");
    expect(readRememberedVisibility("u2")).toBe(null);
  });

  it("does not remember a hidden profile as the thing to restore", () => {
    rememberVisibility("u1", "private");
    expect(readRememberedVisibility("u1")).toBe(null);
  });

  it("clears", () => {
    rememberVisibility("u1", "public");
    clearRememberedVisibility("u1");
    expect(readRememberedVisibility("u1")).toBe(null);
  });
});

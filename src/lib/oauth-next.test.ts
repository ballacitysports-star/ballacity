// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { OAUTH_NEXT_KEY, clearOAuthNext, readOAuthNext, stashOAuthNext } from "@/lib/oauth-next";

describe("oauth-next stash", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("round-trips a safe path under the key the root listener reads", () => {
    stashOAuthNext("/trainers?src=x");
    expect(window.sessionStorage.getItem(OAUTH_NEXT_KEY)).toBe("/trainers?src=x");
    expect(OAUTH_NEXT_KEY).toBe("openrun:oauth-next");
    expect(readOAuthNext()).toBe("/trainers?src=x");
  });

  it("clears a stale stash when the new attempt has no next", () => {
    window.sessionStorage.setItem(OAUTH_NEXT_KEY, "/trainers");
    stashOAuthNext(undefined);
    expect(readOAuthNext()).toBeUndefined();
  });

  it("never hands back an off-site or looping path, even if storage holds one", () => {
    window.sessionStorage.setItem(OAUTH_NEXT_KEY, "https://evil.example/");
    expect(readOAuthNext()).toBeUndefined();
    window.sessionStorage.setItem(OAUTH_NEXT_KEY, "/auth");
    expect(readOAuthNext()).toBeUndefined();
  });

  it("forgets the page once it has been used", () => {
    stashOAuthNext("/trainers");
    clearOAuthNext();
    expect(window.sessionStorage.getItem(OAUTH_NEXT_KEY)).toBeNull();
  });
});

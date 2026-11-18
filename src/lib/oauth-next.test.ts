// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  OAUTH_NEXT_KEY,
  clearOAuthNext,
  oauthNextForPage,
  readOAuthNext,
  stashOAuthNext,
} from "@/lib/oauth-next";

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

describe("oauthNextForPage", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("keeps the page it read on mount after the root listener removes the stash", () => {
    stashOAuthNext("/trainers?src=x");
    const page = oauthNextForPage();
    // The root's SIGNED_IN listener consumes the stash between two /auth calls.
    window.sessionStorage.removeItem(OAUTH_NEXT_KEY);
    expect(page.get()).toBe("/trainers?src=x");
  });

  it("does not pick up a stash written by someone else after the page read it", () => {
    const page = oauthNextForPage();
    window.sessionStorage.setItem(OAUTH_NEXT_KEY, "/trainers");
    expect(page.get()).toBeUndefined();
  });

  it("follows this page's own Google/Apple button, including clearing a stale stash", () => {
    window.sessionStorage.setItem(OAUTH_NEXT_KEY, "/stale");
    const page = oauthNextForPage();
    page.stash("/players");
    expect(page.get()).toBe("/players");
    expect(readOAuthNext()).toBe("/players");
    page.stash(undefined);
    expect(page.get()).toBeUndefined();
    expect(window.sessionStorage.getItem(OAUTH_NEXT_KEY)).toBeNull();
  });

  it("once used, removes it from storage but still answers the same for this sign-in", () => {
    stashOAuthNext("/trainers");
    const page = oauthNextForPage();
    page.used();
    expect(window.sessionStorage.getItem(OAUTH_NEXT_KEY)).toBeNull();
    expect(page.get()).toBe("/trainers");
  });

  it("never hands back an unsafe stash", () => {
    window.sessionStorage.setItem(OAUTH_NEXT_KEY, "https://evil.example/");
    expect(oauthNextForPage().get()).toBeUndefined();
  });
});

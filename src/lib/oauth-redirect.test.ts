import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  assertValidOAuthRedirectUri,
  getOAuthRedirectUri,
  OAUTH_CALLBACK_PATH,
} from "./oauth-redirect";

describe("getOAuthRedirectUri", () => {
  it("appends /oauth/callback to the given origin", () => {
    expect(getOAuthRedirectUri("https://example.com")).toBe(
      "https://example.com/oauth/callback",
    );
  });

  it("normalizes trailing slashes", () => {
    expect(getOAuthRedirectUri("https://example.com/")).toBe(
      "https://example.com/oauth/callback",
    );
  });

  it("works for preview and localhost origins", () => {
    expect(getOAuthRedirectUri("http://localhost:8080")).toBe(
      "http://localhost:8080/oauth/callback",
    );
    expect(
      getOAuthRedirectUri("https://id-preview--abc.lovable.app"),
    ).toBe("https://id-preview--abc.lovable.app/oauth/callback");
  });

  it("throws when no origin is available (SSR path)", () => {
    expect(() => getOAuthRedirectUri("")).toThrow(/no origin available/);
  });
});

describe("assertValidOAuthRedirectUri", () => {
  it("accepts the canonical callback URL", () => {
    expect(() =>
      assertValidOAuthRedirectUri("https://example.com/oauth/callback"),
    ).not.toThrow();
  });

  it("rejects a bare origin (the historical bug)", () => {
    expect(() =>
      assertValidOAuthRedirectUri("https://example.com"),
    ).toThrow(/pathname must be/);
    expect(() =>
      assertValidOAuthRedirectUri("https://example.com/"),
    ).toThrow(/pathname must be/);
  });

  it("rejects arbitrary other paths", () => {
    expect(() =>
      assertValidOAuthRedirectUri("https://example.com/profile"),
    ).toThrow(/pathname must be/);
  });

  it("rejects URLs with query strings or hashes", () => {
    expect(() =>
      assertValidOAuthRedirectUri("https://example.com/oauth/callback?x=1"),
    ).toThrow(/must not include query or hash/);
    expect(() =>
      assertValidOAuthRedirectUri("https://example.com/oauth/callback#x"),
    ).toThrow(/must not include query or hash/);
  });

  it("rejects malformed URLs", () => {
    expect(() => assertValidOAuthRedirectUri("not a url")).toThrow(
      /not a valid URL/,
    );
  });
});

/**
 * Static configuration check: no source file under src/ (outside the helper
 * and its test) may pass `window.location.origin` alone to
 * `signInWithOAuth` — that regressed the full-page redirect and stranded
 * users on `/`. New OAuth call sites must import `getOAuthRedirectUri()`.
 */
describe("no call site inlines window.location.origin as redirect_uri", () => {
  const SRC = join(process.cwd(), "src");
  const ALLOW = new Set([
    join(SRC, "lib", "oauth-redirect.ts"),
    join(SRC, "lib", "oauth-redirect.test.ts"),
  ]);

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("uses getOAuthRedirectUri() everywhere", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (ALLOW.has(file)) continue;
      const src = readFileSync(file, "utf8");
      // Match `redirect_uri: window.location.origin` (with optional whitespace,
      // NOT followed by a string concatenation continuing the URL).
      const re = /redirect_uri\s*:\s*window\.location\.origin\s*[,}\n]/;
      if (re.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      `These files inline window.location.origin as redirect_uri — use getOAuthRedirectUri() from @/lib/oauth-redirect instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("callback path constant matches the route file", () => {
    // Route file is src/routes/oauth.callback.tsx → URL /oauth/callback.
    expect(OAUTH_CALLBACK_PATH).toBe("/oauth/callback");
  });
});

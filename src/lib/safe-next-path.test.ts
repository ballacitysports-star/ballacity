import { describe, expect, it } from "vitest";
import { defaultParseSearch } from "@tanstack/react-router";
import { sanitizeNextPath } from "@/lib/safe-next-path";
import { DEFAULT_POST_AUTH_DESTINATION, postAuthDestination } from "@/lib/post-auth-destination";

/**
 * After sign-in, `/auth` hands the sanitized `next` to `window.location.replace`.
 * Whatever this filter lets through, the browser follows, so a crafted link must
 * never leave the site.
 */

const SITE = "https://ballacity.example";

/** Where a browser would land if `/auth` sent it to `path`. */
const landing = (path: string) => new URL(path, SITE);

// Each is the decoded value `/auth` sees in `next`.
const CRAFTED = [
  "//evil.com",
  "//evil.com/feed",
  "///evil.com",
  "https://evil.com",
  "http://evil.com/feed",
  "HTTPS://evil.com",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "/\\evil.com",
  "/\\/evil.com",
  "\\\\evil.com",
  "\\/evil.com",
  "/\t/evil.com",
  "/\n/evil.com",
  "/\r\n/evil.com",
  "/\u0000/evil.com",
  " //evil.com",
  "evil.com",
  "%2F%2Fevil.com",
  "%2f%2fevil.com",
  "%5C%5Cevil.com",
  "/%09/evil.com/".replace("%09", "\t"),
  "/.//evil.com",
  "/x/..//evil.com",
  "/%2e//evil.com",
  "/x/%2E%2E//evil.com",
];

// The raw query strings an attacker would put in a link, decoded the way the
// router decodes `/auth`'s search.
const CRAFTED_QUERIES = [
  "?next=%2F%2Fevil.com",
  "?next=https%3A%2F%2Fevil.com",
  "?next=%2F%5Cevil.com",
  "?next=%2F%5C%2Fevil.com",
  "?next=%2F%09%2Fevil.com",
  "?next=%2F%0A%2Fevil.com",
  "?next=javascript%3Aalert(1)",
  "?next=%252F%252Fevil.com",
  "?next=%22%2F%2Fevil.com%22",
  "?next=%22%2F%5Cevil.com%22",
  "?next=%2F.%2F%2Fevil.com",
  "?next=%2Fx%2F..%2F%2Fevil.com",
];

describe("sanitizeNextPath: a crafted next never leaves the site", () => {
  it.each(CRAFTED)("refuses %j", (raw) => {
    expect(sanitizeNextPath(raw)).toBeUndefined();
  });

  it.each(CRAFTED_QUERIES)("refuses the decoded value of %s", (query) => {
    const { next } = defaultParseSearch(query) as { next?: unknown };
    const safe = sanitizeNextPath(next);
    if (safe !== undefined) expect(landing(safe).origin).toBe(SITE);
    expect(safe).toBeUndefined();
  });

  it.each(CRAFTED)("leaves the post-sign-in destination on this site for %j", (raw) => {
    const dest = postAuthDestination({
      next: sanitizeNextPath(raw),
      needsAccountType: false,
    });
    expect(dest).toBe(DEFAULT_POST_AUTH_DESTINATION);
    expect(landing(dest).origin).toBe(SITE);
  });

  it("keeps percent-encoded slashes inside the path, where the browser does not decode them", () => {
    // `/%2F%2Fevil.com` is a path on this site, not a host.
    const safe = sanitizeNextPath("/%2F%2Fevil.com");
    expect(safe).toBe("/%2F%2Fevil.com");
    expect(landing(safe!).origin).toBe(SITE);
    expect(sanitizeNextPath("/%5Cevil.com")).toBe("/%5Cevil.com");
    expect(landing("/%5Cevil.com").origin).toBe(SITE);
  });
});

describe("sanitizeNextPath: pages on this site", () => {
  it.each([
    "/feed",
    "/games/g1",
    "/trainers/t1?tab=book",
    "/player-card/u1?clip=c1#reels",
    "/cities?city=atlanta&sport=Basketball",
    "/parent/consent/abc123",
  ])("keeps %j as is", (path) => {
    expect(sanitizeNextPath(path)).toBe(path);
  });

  it.each([
    "/",
    "/?ref=x",
    "/#top",
    "/auth",
    "/auth?next=/feed",
    "/auth/callback",
    "/AUTH",
    "/x/../auth",
    "/reset-password",
    "/reset-password/abc",
  ])("refuses %j, which would loop back through sign-in", (path) => {
    expect(sanitizeNextPath(path)).toBeUndefined();
  });

  it.each([undefined, null, "", 42, {}, ["/feed"]])("refuses the non-path %j", (raw) => {
    expect(sanitizeNextPath(raw)).toBeUndefined();
  });
});

describe("/auth reads next through this filter", () => {
  const validate = async (query: string) => {
    const { Route } = await import("@/routes/auth");
    const validateSearch = Route.options.validateSearch as (s: Record<string, unknown>) => {
      next?: string;
    };
    return validateSearch(defaultParseSearch(query));
  };

  it.each(CRAFTED_QUERIES)("drops next from /auth%s", async (query) => {
    expect((await validate(query)).next).toBeUndefined();
  });

  it("keeps a next on this site, query included", async () => {
    const next = "/trainers/t1?tab=book";
    expect(await validate(`?next=${encodeURIComponent(next)}`)).toEqual({ next });
  });
});

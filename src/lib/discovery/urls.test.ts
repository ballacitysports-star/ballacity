import { describe, expect, it } from "vitest";
import {
  hostKey,
  isBlockedHost,
  isPublicHttpUrl,
  normalizeWebUrl,
  parseRobots,
  robotsFromResponse,
} from "./urls";

describe("normalizeWebUrl", () => {
  it("adds a scheme, drops fragments and tracking, keeps real parameters", () => {
    expect(normalizeWebUrl("www.peachhoops.com/programs?utm_source=x&id=4#top")).toBe(
      "https://www.peachhoops.com/programs?id=4",
    );
    expect(normalizeWebUrl("  http://example.org  ")).toBe("http://example.org/");
  });

  it("refuses anything that is not a plain public site", () => {
    for (const bad of [
      "",
      "ftp://example.com/file",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "http://localhost/admin",
      "http://127.0.0.1/",
      "http://2130706433/", // 127.0.0.1 as one number
      "http://0x7f000001/",
      "http://10.0.0.5/",
      "http://[::1]/",
      "http://intranet/",
      "http://printer.local/",
      "http://metadata.internal/",
      "https://user:pass@example.com/",
      "https://example.com:8443/",
      "https://exa mple.com/",
    ]) {
      expect(normalizeWebUrl(bad), bad).toBeNull();
    }
  });

  it("never fetches social, review, search or marketplace sites", () => {
    for (const host of [
      "facebook.com",
      "m.facebook.com",
      "www.instagram.com",
      "x.com",
      "yelp.com",
      "maps.google.com",
      "www.linkedin.com",
      "en.wikipedia.org",
    ]) {
      expect(isBlockedHost(host), host).toBe(true);
      expect(normalizeWebUrl(`https://${host}/page`), host).toBeNull();
    }
    expect(isBlockedHost("notfacebook.com")).toBe(false);
    expect(isPublicHttpUrl("https://peachstatehoops.com")).toBe(true);
  });

  it("keys a site by host without www", () => {
    expect(hostKey("https://WWW.Example.com/a")).toBe("example.com");
    expect(hostKey("not a url")).toBe("");
  });
});

describe("robots.txt", () => {
  const body = `
# comment
User-agent: *
Disallow: /private
Disallow: /*.pdf$
Allow: /private/open

User-agent: ballacitybot
Disallow: /members
`;

  it("uses the group that names us instead of the general one", () => {
    const rules = parseRobots(body);
    expect(rules.allows("/members/list")).toBe(false);
    expect(rules.allows("/private")).toBe(true); // the general group no longer applies
  });

  it("falls back to the general group, longest rule winning, Allow on a tie", () => {
    const rules = parseRobots(
      "User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.pdf$\n",
    );
    expect(rules.allows("/private/data")).toBe(false);
    expect(rules.allows("/private/open/page")).toBe(true);
    expect(rules.allows("/files/schedule.pdf")).toBe(false);
    expect(rules.allows("/files/schedule.pdf?download=1")).toBe(true); // "$" anchors the end
    expect(rules.allows("/")).toBe(true);
    const tie = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a\n");
    expect(tie.allows("/a")).toBe(true);
  });

  it("treats Disallow: / as closed and an empty Disallow as open", () => {
    expect(parseRobots("User-agent: *\nDisallow: /").allows("/anything")).toBe(false);
    expect(parseRobots("User-agent: *\nDisallow:").allows("/anything")).toBe(true);
  });

  it("applies one group to several agents listed together", () => {
    const rules = parseRobots(
      "User-agent: googlebot\nUser-agent: ballacitybot/1.0\nDisallow: /x\n",
    );
    expect(rules.allows("/x")).toBe(false);
  });

  it("follows RFC 9309 for fetch outcomes", () => {
    expect(robotsFromResponse(200, "User-agent: *\nDisallow: /").allows("/a")).toBe(false);
    expect(robotsFromResponse(404, "").allows("/a")).toBe(true);
    expect(robotsFromResponse(403, "").allows("/a")).toBe(true);
    expect(robotsFromResponse(503, "").allows("/a")).toBe(false);
    expect(robotsFromResponse(null, "").allows("/a")).toBe(false);
  });
});

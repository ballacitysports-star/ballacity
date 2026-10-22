import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTENT_STUDIO_SETTINGS,
  SourceUrlRejected,
  classifyGraphError,
  cleanDraftHashtags,
  cleanFacts,
  composePostMessage,
  hasUnverifiedFacts,
  isBallaCityLink,
  normalizeSourceUrl,
  parseContentStudioSettings,
} from "./content-studio";

function rejected(raw: string) {
  try {
    normalizeSourceUrl(raw);
    return null;
  } catch (e) {
    return e instanceof SourceUrlRejected ? e.code : "OTHER";
  }
}

describe("normalizeSourceUrl", () => {
  it("canonicalises a Facebook post so the same post is one record", () => {
    const a = normalizeSourceUrl(
      "https://m.facebook.com/TheRunClub/posts/12345/?fbclid=abc&utm_source=x&mibextid=Z#comments",
    );
    const b = normalizeSourceUrl("https://www.facebook.com/TheRunClub/posts/12345");
    expect(a.normalizedUrl).toBe("https://facebook.com/TheRunClub/posts/12345");
    expect(b.normalizedUrl).toBe(a.normalizedUrl);
    expect(a).toMatchObject({ platform: "facebook", kind: "post", host: "facebook.com" });
  });

  it("keeps the query parameters that identify content, in a stable order", () => {
    const a = normalizeSourceUrl(
      "https://www.facebook.com/permalink.php?story_fbid=9&id=7&__tn__=K",
    );
    expect(a.normalizedUrl).toBe("https://facebook.com/permalink.php?id=7&story_fbid=9");
    expect(a.kind).toBe("post");
  });

  it("classifies Facebook events, groups, videos and pages", () => {
    expect(normalizeSourceUrl("facebook.com/events/42/").kind).toBe("event");
    expect(normalizeSourceUrl("https://www.facebook.com/groups/hoopers").kind).toBe("group");
    expect(normalizeSourceUrl("https://fb.watch/abc123/").kind).toBe("video");
    expect(normalizeSourceUrl("https://www.facebook.com/reel/77").kind).toBe("video");
    expect(normalizeSourceUrl("https://www.facebook.com/CityHoopsLeague").kind).toBe("page");
  });

  it("treats other sites as plain web references", () => {
    expect(normalizeSourceUrl("http://Example.org/tryouts/")).toMatchObject({
      platform: "web",
      kind: "other",
      normalizedUrl: "https://example.org/tryouts",
    });
    expect(normalizeSourceUrl("https://www.instagram.com/p/XYZ/?igsh=1").normalizedUrl).toBe(
      "https://instagram.com/p/XYZ",
    );
  });

  it("refuses anything that is not a plain public web address", () => {
    expect(rejected("")).toBe("URL_INVALID");
    expect(rejected("javascript:alert(1)")).toBe("URL_SCHEME");
    expect(rejected("file:///etc/passwd")).toBe("URL_SCHEME");
    expect(rejected("ftp://example.org/x")).toBe("URL_SCHEME");
    expect(rejected("https://user:pass@facebook.com/x")).toBe("URL_CREDENTIALS");
    expect(rejected("https://facebook.com:8443/x")).toBe("URL_PORT");
    expect(rejected("http://localhost/x")).toBe("URL_HOST");
    expect(rejected("http://127.0.0.1/admin")).toBe("URL_HOST");
    expect(rejected("http://169.254.169.254/latest/meta-data")).toBe("URL_HOST");
    expect(rejected("http://[::1]/")).toBe("URL_HOST");
    expect(rejected("http://intranet/")).toBe("URL_HOST");
    expect(rejected(`https://facebook.com/${"a".repeat(2100)}`)).toBe("URL_TOO_LONG");
  });
});

describe("draft helpers", () => {
  it("only allows https links to BallaCity", () => {
    expect(isBallaCityLink("https://ballacity.com/games/g1")).toBe(true);
    expect(isBallaCityLink("https://www.ballacity.com/teams/t")).toBe(true);
    expect(isBallaCityLink("http://ballacity.com/games/g1")).toBe(false);
    expect(isBallaCityLink("https://ballacity.com.evil.example/x")).toBe(false);
    expect(isBallaCityLink("https://facebook.com/x")).toBe(false);
    expect(isBallaCityLink("https://u:p@ballacity.com/x")).toBe(false);
    expect(isBallaCityLink(null)).toBe(false);
  });

  it("cleans hashtags and caps them", () => {
    expect(cleanDraftHashtags(["#Hoops", "hoops", "pick up", "x".repeat(41)])).toEqual([
      "Hoops",
      "pickup",
    ]);
    expect(cleanDraftHashtags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(10);
  });

  it("keeps fact status honest: unknown statuses become unverified", () => {
    const facts = cleanFacts([
      { claim: "Saturday 9am", status: "verified" },
      { claim: "Free to join", status: "true" },
      { claim: "   " },
      "junk",
    ]);
    expect(facts).toEqual([
      { claim: "Saturday 9am", status: "verified" },
      { claim: "Free to join", status: "unverified" },
    ]);
    expect(hasUnverifiedFacts(facts)).toBe(true);
    expect(hasUnverifiedFacts([{ claim: "a", status: "verified" }])).toBe(false);
    expect(cleanFacts("nope")).toEqual([]);
  });

  it("posts the message with hashtags on their own line", () => {
    expect(
      composePostMessage({ message: " Run Saturday ", hashtags: ["BallaCity", "#hoops"] }),
    ).toBe("Run Saturday\n\n#BallaCity #hoops");
    expect(composePostMessage({ message: "Just text" })).toBe("Just text");
  });
});

describe("settings", () => {
  it("defaults to publishing off and survives junk", () => {
    expect(DEFAULT_CONTENT_STUDIO_SETTINGS.publishing).toBe(false);
    expect(parseContentStudioSettings(null)).toEqual(DEFAULT_CONTENT_STUDIO_SETTINGS);
    expect(parseContentStudioSettings({ publishing: "yes", discovery: false })).toEqual({
      ...DEFAULT_CONTENT_STUDIO_SETTINGS,
      discovery: false,
    });
  });
});

describe("classifyGraphError", () => {
  it("maps the Graph error codes the studio acts on", () => {
    expect(classifyGraphError({ code: 190 })).toBe("TOKEN_EXPIRED");
    expect(classifyGraphError({ code: 200 })).toBe("PERMISSION_MISSING");
    expect(classifyGraphError({ code: 10 })).toBe("PERMISSION_MISSING");
    expect(classifyGraphError({ code: 32 })).toBe("RATE_LIMITED");
    expect(classifyGraphError({ code: 368 })).toBe("CONTENT_BLOCKED");
    expect(classifyGraphError({ code: 1 })).toBe("GRAPH_ERROR");
    expect(classifyGraphError(null)).toBe("GRAPH_ERROR");
  });
});

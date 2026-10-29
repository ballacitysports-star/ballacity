import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Source-level checks for the landing page and the public city page. They pin routing and
 * the absence of automatic location requests; they do not render either page.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const landing = read("routes/index.tsx");
const cities = read("routes/cities.index.tsx");
const gamePage = read("routes/games.$gameId.index.tsx");

/** The JSX of the <Link ...> that contains `text`, up to its closing tag. */
function linkContaining(src: string, text: string): string {
  const at = src.indexOf(text);
  expect(at, `"${text}" should exist`).toBeGreaterThan(-1);
  const open = src.lastIndexOf("<Link", at);
  return src.slice(open, at + text.length);
}

describe("landing page: Find a game near me", () => {
  it("leads a signed-out visitor to the public city listings, not the members' feed", () => {
    const cta = linkContaining(landing, "Find a game near me");
    expect(cta).toMatch(/to="\/cities"/);
    expect(cta).not.toMatch(/to="\/feed"/);
  });

  it("sends the Trending See all link to the same public page", () => {
    const link = linkContaining(landing, "See all");
    expect(link).toMatch(/to="\/cities"/);
  });

  it("no longer claims the trending list is near the visitor", () => {
    expect(landing).not.toContain("Trending near you");
    expect(landing).not.toContain("No games posted near you yet");
  });

  it("only renders the hero for signed-out visitors", () => {
    // Members get the redirect skeleton, so this change cannot affect signed-in discovery.
    expect(landing).toMatch(
      /if \(user \|\| \(loading && hasStoredSession\)\) return <AuthRedirectSkeleton/,
    );
  });
});

describe("public city page", () => {
  it("never asks for location on its own: geolocation is read only inside the tap handler", () => {
    expect(cities.match(/navigator\.geolocation/g)?.length).toBe(2); // availability check + request
    expect(cities.match(/getCurrentPosition/g)?.length).toBe(1);
    const start = cities.indexOf("const useMyLocation");
    const end = cities.indexOf("return (\n    <div", start);
    const handler = cities.slice(start, end);
    expect(handler).toContain("getCurrentPosition");
    // Nothing outside that handler touches geolocation, and no effect calls it.
    const outside = cities.slice(0, start) + cities.slice(end);
    expect(outside).not.toMatch(/geolocation|getCurrentPosition/);
    expect(cities).toMatch(/onClick=\{useMyLocation\}/);
  });

  it("reads games only through the existing public server function", () => {
    expect(cities).toContain('from "@/lib/city-pages.functions"');
    expect(cities).toContain("getCityListings");
    expect(cities).not.toMatch(/supabase|\.from\("hosted_games"\)/);
  });

  it("returns to the same city and sport after sign-up or sign-in", () => {
    expect(cities).toMatch(/useLocation\(\{ select: \(l\) => l\.href \}\)/);
    expect(cities).toMatch(/search=\{\{ next \}\}/);
    expect(cities).toContain("<PublicGamesEmpty");
  });
});

describe("participation stays behind sign-in", () => {
  it("the game page shows signed-out visitors the preview and keeps their destination", () => {
    expect(gamePage).toMatch(
      /if \(!user\) return <PublicGamePreview seo=\{seo\} next=\{`\$\{pathname\}\$\{searchStr\}`\} \/>;/,
    );
  });
});

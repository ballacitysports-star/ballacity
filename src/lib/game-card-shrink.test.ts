import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * GameCard's wrapper must be allowed to shrink below its content.
 *
 * Every consumer renders GameCard into a CSS grid. A grid item defaults to
 * `min-width: auto`, which refuses to shrink below the item's min-content
 * width — so a card whose contents are collectively wider than the track
 * overflows the track instead of compressing, and takes the page's horizontal
 * scroll with it.
 *
 * Measured in a real browser at a 320px viewport: the grid track resolved to
 * 294px while the card sat at 361px, pushing document.scrollWidth to 374px.
 * Setting `min-width: 0` on the wrapper collapsed it to the track's 294px, as
 * did forcing `minmax(0, 1fr)` on the track. No single descendant had a
 * min-content width over 300px — it is the composition, not one long string,
 * which is why there is nothing to shorten and the constraint has to be lifted
 * here.
 *
 * This regressed invisibly for a long time because the feed had no games to
 * render: an empty grid cannot overflow, so viewport sweeps passed while the
 * bug was live. It only surfaced once fixture games were seeded. That is
 * exactly the kind of failure a source-level pin catches and a screenshot
 * does not.
 */

const src = readFileSync(new URL("../components/GameCard.tsx", import.meta.url), "utf8");

describe("GameCard fits its grid track", () => {
  it("lets its outer wrapper shrink below min-content", () => {
    // The wrapper is the grid item; the constraint applies to it, not to the
    // inner <Link>, whose overflow-hidden only clips what is already too wide.
    const at = src.indexOf("enter-up");
    expect(at, "the enter-up wrapper should still exist").toBeGreaterThan(-1);
    const wrapper = src.slice(at - 200, at + 200);
    expect(wrapper).toMatch(/enter-up[^"]*\bmin-w-0\b|\bmin-w-0\b[^"]*enter-up/);
  });

  it("keeps the clip on the card surface", () => {
    // min-w-0 lets the item narrow; overflow-hidden is what stops the rounded
    // surface's children from painting outside it once it does. The surface is
    // a flex column now (equal card heights in a grid row), so the assertion is
    // on the clip rather than on `block`.
    expect(src).toMatch(/group flex h-full flex-col overflow-hidden/);
  });
});

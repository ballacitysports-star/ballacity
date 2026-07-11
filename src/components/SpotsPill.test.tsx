import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SpotsPill } from "./SpotsPill";

/**
 * Accessibility contract for the Discover bottom card "N spots" pill.
 *
 * The pill is the ONLY surface that announces roster changes to screen
 * reader users while they browse the map — the visual pin colour update
 * is not perceivable without sight. It must therefore be a live region
 * and it must re-announce the full label atomically when the count
 * changes (so SR users hear "3 spots left", not just "3").
 */
describe("SpotsPill (a11y)", () => {
  it("is a polite, atomic live region so SR announces updates without interrupting", () => {
    const html = renderToStaticMarkup(<SpotsPill spotsLeft={5} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    // Redundant role for older SR compatibility; must be status, not alert
    // (alert would interrupt the user mid-sentence).
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it("exposes a full, human-readable label for screen readers", () => {
    const html = renderToStaticMarkup(<SpotsPill spotsLeft={5} />);
    expect(html).toContain('aria-label="5 spots left"');
    // Visible text is still present for sighted users.
    expect(html).toContain(">5 spots<");
  });

  it("pluralises correctly at 1 spot so the announcement is grammatical", () => {
    const html = renderToStaticMarkup(<SpotsPill spotsLeft={1} />);
    expect(html).toContain('aria-label="1 spot left"');
  });

  it("announces the full state assertively with an explicit message", () => {
    // When the game hits capacity, further join attempts will fail.
    // SR users need immediate feedback (assertive interrupts current
    // speech) and a human-readable label — not a bare "0 spots left"
    // which is easy to miss mid-sentence.
    const html = renderToStaticMarkup(<SpotsPill spotsLeft={0} />);
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('aria-label="Game is full — no spots remaining"');
    // Still status, not alert — this is expected state, not an error.
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    // Visible text switches to "Full" for sighted users.
    expect(html).toContain(">Full<");
  });

  it("stays polite while spots remain so decrements don't spam the SR", () => {
    const html = renderToStaticMarkup(<SpotsPill spotsLeft={3} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('aria-live="assertive"');
  });

  it("escalates from polite to assertive when the last spot is taken", () => {
    // Simulate the realtime transition from 1 -> 0. The politeness
    // MUST change so SR users hear the "full" message even if they
    // were mid-sentence.
    const beforeFull = renderToStaticMarkup(<SpotsPill spotsLeft={1} />);
    const atFull = renderToStaticMarkup(<SpotsPill spotsLeft={0} />);
    expect(beforeFull).toContain('aria-live="polite"');
    expect(atFull).toContain('aria-live="assertive"');
    expect(atFull).toContain('aria-label="Game is full — no spots remaining"');
  });

  it("re-renders with the new count so aria-live picks up the change", () => {
    // Simulate a realtime update: same component, new spotsLeft prop.
    // Both the visible text and the aria-label must reflect the new
    // value, otherwise SR users would hear a stale announcement.
    const before = renderToStaticMarkup(<SpotsPill spotsLeft={5} />);
    const after = renderToStaticMarkup(<SpotsPill spotsLeft={4} />);
    expect(before).toContain('aria-label="5 spots left"');
    expect(after).toContain('aria-label="4 spots left"');
    expect(before).not.toEqual(after);
  });
});

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SpotsPill } from "./SpotsPill";

/**
 * Accessibility contract for the roster "N spots" pill.
 *
 * The pill announces roster changes to screen reader users while they
 * browse — the visual pin colour update is not perceivable without
 * sight. It must therefore be a live region and it must re-announce
 * the full label atomically when the count changes (so SR users hear
 * "3 spots left", not just "3").
 *
 * Politeness stays polite for all remaining-spot states so that a
 * stream of joins doesn't spam the SR buffer; only the terminal "full"
 * state escalates to assertive.
 */
describe("SpotsPill (a11y)", () => {
  it("is a polite, atomic live region so SR announces updates without interrupting", () => {
    const html = renderToStaticMarkup(<SpotsPill spotsLeft={5} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it("exposes a full, human-readable label for screen readers (normal)", () => {
    const html = renderToStaticMarkup(<SpotsPill spotsLeft={5} />);
    expect(html).toContain('aria-label="5 spots left"');
    expect(html).toContain(">5 spots<");
  });

  it("escalates the label copy to convey urgency at 1-3 spots", () => {
    const html = renderToStaticMarkup(<SpotsPill spotsLeft={2} />);
    // Urgency copy for SR users; visible chip stays compact.
    expect(html).toContain('aria-label="Only 2 spots left — filling fast"');
    expect(html).toContain(">2 spots<");
  });

  it("pluralises correctly at 1 spot so the announcement is grammatical", () => {
    const html = renderToStaticMarkup(<SpotsPill spotsLeft={1} />);
    expect(html).toContain('aria-label="Only 1 spot left — filling fast"');
  });

  it("announces the full state assertively with an explicit message", () => {
    const html = renderToStaticMarkup(<SpotsPill spotsLeft={0} />);
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('aria-label="Game is full — no spots remaining"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain(">Full<");
  });

  it("stays polite while spots remain so decrements don't spam the SR", () => {
    const html = renderToStaticMarkup(<SpotsPill spotsLeft={3} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('aria-live="assertive"');
  });

  it("escalates from polite to assertive when the last spot is taken", () => {
    const beforeFull = renderToStaticMarkup(<SpotsPill spotsLeft={1} />);
    const atFull = renderToStaticMarkup(<SpotsPill spotsLeft={0} />);
    expect(beforeFull).toContain('aria-live="polite"');
    expect(atFull).toContain('aria-live="assertive"');
    expect(atFull).toContain('aria-label="Game is full — no spots remaining"');
  });

  it("re-renders with the new count so aria-live picks up the change", () => {
    const before = renderToStaticMarkup(<SpotsPill spotsLeft={5} />);
    const after = renderToStaticMarkup(<SpotsPill spotsLeft={4} />);
    expect(before).toContain('aria-label="5 spots left"');
    expect(after).toContain('aria-label="4 spots left"');
    expect(before).not.toEqual(after);
  });

  it("uses amber 'low' styling when >3 remain but ≤20% of capacity", () => {
    const html = renderToStaticMarkup(<SpotsPill spotsLeft={4} maxPlayers={20} />);
    expect(html).toContain("amber");
    // Copy stays neutral in the low bucket to keep SR announcements calm.
    expect(html).toContain('aria-label="4 spots left"');
  });

  it("uses coral pulse styling when critical (1-3 spots)", () => {
    const html = renderToStaticMarkup(<SpotsPill spotsLeft={2} maxPlayers={20} />);
    expect(html).toContain("bg-coral");
    expect(html).toContain("animate-pulse");
  });
});

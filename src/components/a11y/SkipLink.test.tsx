// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MAIN_CONTENT_ID, MainContentTarget, SkipLink } from "./SkipLink";

afterEach(cleanup);

describe("skip link (P3-5)", () => {
  it("is a link to the main content that only shows on focus", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: "Skip to content" });
    expect(link.getAttribute("href")).toBe(`#${MAIN_CONTENT_ID}`);
    expect(link.className).toContain("sr-only");
    expect(link.className).toContain("focus:not-sr-only");
  });

  it("moves keyboard focus to the main content target", () => {
    render(
      <>
        <SkipLink />
        <button type="button">Staff bar</button>
        <MainContentTarget />
        <h1>Page</h1>
      </>,
    );
    const target = document.getElementById(MAIN_CONTENT_ID)!;
    // jsdom has no layout, so scrollIntoView is a no-op stub here.
    target.scrollIntoView = () => {};
    fireEvent.click(screen.getByRole("link", { name: "Skip to content" }));
    expect(document.activeElement).toBe(target);
    expect(target.getAttribute("tabindex")).toBe("-1");
  });

  it("names the target with hidden text, not a prohibited aria-label on a plain div", () => {
    render(<MainContentTarget />);
    const target = document.getElementById(MAIN_CONTENT_ID)!;
    expect(target.hasAttribute("aria-label")).toBe(false);
    expect(target.textContent).toBe("Main content");
    expect(target.querySelector("span")?.className).toContain("sr-only");
  });

  it("the root renders the skip link first, the target before the page, and honours reduced motion", () => {
    const src = readFileSync("src/routes/__root.tsx", "utf8");
    expect(src).toContain('<MotionConfig reducedMotion="user">');
    const skip = src.indexOf("<SkipLink />");
    const staff = src.indexOf("<StaffBar />");
    const target = src.indexOf("<MainContentTarget />");
    const outlet = src.indexOf("<Outlet />");
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(staff);
    expect(staff).toBeLessThan(target);
    expect(target).toBeLessThan(outlet);
  });
});

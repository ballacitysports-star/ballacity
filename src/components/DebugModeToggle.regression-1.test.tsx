// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DebugModeToggle } from "./DebugModeToggle";

// Regression: ISSUE-001 — developer-only debug toggle rendered for every visitor in production
// Found by /qa on 2026-11-06
// Value: protects=end users never see the dev-only debug button; fails_when=the production gate in DebugModeToggle is removed; why_new=no test covered DebugModeToggle; seam=none; no_claim=jsdom with a stubbed build flag, not a real production bundle

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("DebugModeToggle", () => {
  it("renders nothing in a production build", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("PROD", true);
    const { container } = render(<DebugModeToggle />);
    expect(screen.queryByRole("button", { name: "Toggle debug mode" })).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("still renders the toggle during development", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("PROD", false);
    render(<DebugModeToggle />);
    expect(screen.getByRole("button", { name: "Toggle debug mode" })).toBeTruthy();
  });
});

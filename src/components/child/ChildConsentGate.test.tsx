// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
  pathname: "/games/g1",
  child: {
    status: { cohort: "teen_13_15" } as unknown,
    consentBlocked: true,
    state: "PARENTAL_CONSENT_REQUIRED",
    isLoading: false,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: state.pathname }),
}));
vi.mock("@/lib/child-safety", () => ({ useMyChildStatus: () => state.child }));

import { ChildConsentGate } from "./ChildConsentGate";

afterEach(() => {
  cleanup();
  state.pathname = "/games/g1";
  state.child = {
    status: { cohort: "teen_13_15" },
    consentBlocked: true,
    state: "PARENTAL_CONSENT_REQUIRED",
    isLoading: false,
  };
});

describe("ChildConsentGate", () => {
  it("on a game page, tells a minor awaiting consent why and links to the approval flow", () => {
    render(<ChildConsentGate />);
    expect(screen.getByText(/parent approval needed/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: /start approval/i });
    expect(link.getAttribute("href")).toBe("/onboarding/child");
  });

  it("says Check status while the request is with the parent", () => {
    state.child.state = "PARENTAL_CONSENT_PENDING";
    render(<ChildConsentGate />);
    expect(screen.getByRole("link", { name: /check status/i }).getAttribute("href")).toBe(
      "/onboarding/child",
    );
  });

  it("explains a withdrawn consent", () => {
    state.child.state = "PARENTAL_CONSENT_REVOKED";
    render(<ChildConsentGate />);
    expect(screen.getByText(/turned this account off/i)).toBeTruthy();
  });

  it("renders nothing for an account that is not blocked", () => {
    state.child.consentBlocked = false;
    const { container } = render(<ChildConsentGate />);
    expect(container.textContent).toBe("");
  });

  it("stays off the consent flow itself", () => {
    state.pathname = "/onboarding/child";
    const { container } = render(<ChildConsentGate />);
    expect(container.textContent).toBe("");
  });

  it("is mounted on the game routes, which sit outside the tab layout", () => {
    const layout = readFileSync(resolve(__dirname, "../../routes/games.$gameId.tsx"), "utf8");
    expect(layout).toMatch(/<ChildConsentGate\s*\/>/);
  });
});

// @vitest-environment jsdom
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ to, children, className }: any) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/PolicyLinks", () => ({ PolicyLinks: () => null }));

import { getSupportState, resetSupportStore } from "@/lib/support/support-store";
import { SUPPORT_EMAIL } from "@/lib/trust";
import { Route } from "@/routes/contact";

const Page = (Route as unknown as { options: { component: () => ReactElement } }).options.component;

beforeEach(() => resetSupportStore());
afterEach(cleanup);

describe("/contact", () => {
  it("offers BallaCity Help first, and opens it", () => {
    render(<Page />);
    const help = screen.getByRole("heading", { name: "Ask BallaCity Help" });
    const email = screen.getByRole("heading", { name: "Email support" });
    expect(help.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getSupportState().open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Open Help" }));
    expect(getSupportState().open).toBe(true);
  });

  it("keeps everything that was already here", () => {
    render(<Page />);
    expect(screen.getByRole("link", { name: SUPPORT_EMAIL }).getAttribute("href")).toBe(
      `mailto:${SUPPORT_EMAIL}`,
    );
    expect(screen.getByRole("heading", { name: "Report a problem" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Emergencies" })).toBeTruthy();
  });
});

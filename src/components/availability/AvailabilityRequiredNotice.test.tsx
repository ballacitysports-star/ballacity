// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * WP 4.1: the explanation shown when a member can't post availability yet. "Complete my profile" carries the way back
 * to posting (`returnTo`), and every next step is a full 44px tap target.
 */
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    search?: Record<string, string>;
    className?: string;
  }) => (
    <a href={search ? `${to}?${new URLSearchParams(search).toString()}` : to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/account-profiles", () => ({
  useMyProfiles: () => ({ profiles: [{ id: "p1", kind: "player", name: "Sam" }] }),
  useSwitchProfile: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/auth-return", () => ({ useAuthSearchHere: () => ({ next: "/feed" }) }));

import { AvailabilityRequiredNotice } from "./AvailabilityRequiredNotice";

afterEach(cleanup);

describe("AvailabilityRequiredNotice", () => {
  it("Complete my profile returns to posting by default", () => {
    render(<AvailabilityRequiredNotice reason="incomplete_profile" />);
    const link = screen.getByRole("link", { name: "Complete my profile" });
    expect(link.getAttribute("href")).toBe(
      `/profile/edit?returnTo=${encodeURIComponent("/availability?compose=quick")}`,
    );
    expect(link.className).toContain("min-h-11");
    expect(screen.getByText("Add your sports and level to post availability.")).toBeTruthy();
  });

  it("takes another way back when given one", () => {
    render(<AvailabilityRequiredNotice reason="incomplete_profile" returnTo="/feed" />);
    expect(screen.getByRole("link", { name: "Complete my profile" }).getAttribute("href")).toBe(
      "/profile/edit?returnTo=%2Ffeed",
    );
  });

  it("offers the profile switch and sign-in as full-size targets", () => {
    render(<AvailabilityRequiredNotice reason="wrong_profile" />);
    expect(screen.getByRole("button", { name: /Switch to my player profile/ }).className).toContain(
      "min-h-11",
    );
    cleanup();
    render(<AvailabilityRequiredNotice reason="signed_out" />);
    expect(screen.getByRole("link", { name: "Sign in" }).className).toContain("min-h-11");
  });

  it("renders nothing when posting is allowed", () => {
    const { container } = render(<AvailabilityRequiredNotice reason={null} />);
    expect(container.innerHTML).toBe("");
  });
});

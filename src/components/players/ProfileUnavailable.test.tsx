// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import {
  PROFILE_UNAVAILABLE_COPY,
  PROFILE_UNAVAILABLE_HINT,
  ProfileUnavailable,
} from "./ProfileUnavailable";

afterEach(cleanup);

describe("ProfileUnavailable", () => {
  it("says a profile is private or unavailable, not removed", () => {
    render(<ProfileUnavailable kind="profile" />);
    expect(screen.getByRole("heading", { name: "Profile unavailable" })).toBeTruthy();
    expect(screen.getByText("This profile is private or unavailable.")).toBeTruthy();
    expect(screen.queryByText(/removed|not found|blocked|minor/i)).toBeNull();
  });

  it("uses the matching sentence for a player card", () => {
    render(<ProfileUnavailable kind="card" />);
    expect(screen.getByRole("heading", { name: "Player card unavailable" })).toBeTruthy();
    expect(screen.getByText("This player card is private or unavailable.")).toBeTruthy();
    expect(screen.queryByText(/removed|not found|blocked|minor/i)).toBeNull();
  });

  it("offers a way back to Find players", () => {
    render(<ProfileUnavailable kind="profile" />);
    expect(screen.getByText(PROFILE_UNAVAILABLE_HINT)).toBeTruthy();
    const find = screen.getByRole("link", { name: "Find players" });
    expect(find.getAttribute("href")).toBe("/players");
  });
});

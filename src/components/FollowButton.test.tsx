// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const auth = { user: { id: "me" } as { id: string } | null };
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }));

const toggle = vi.fn();
let state = { isFollowing: false, requested: false, pending: false, loading: false };
vi.mock("@/lib/follows", () => ({ useFollow: () => ({ ...state, toggle }) }));

import { FollowButton } from "./FollowButton";

afterEach(() => {
  cleanup();
  toggle.mockReset();
  auth.user = { id: "me" };
  state = { isFollowing: false, requested: false, pending: false, loading: false };
});

describe("FollowButton", () => {
  it("offers Follow, and toggles on tap", () => {
    render(<FollowButton userId="them" />);
    const b = screen.getByRole("button", { name: "Follow" });
    expect(b.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(b);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("says Requested while waiting for approval, and a tap withdraws it", () => {
    state.requested = true;
    render(<FollowButton userId="them" />);
    const b = screen.getByRole("button", { name: /Requested/ });
    expect(b.textContent).toContain("Requested");
    expect(b.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(b);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("says Following once approved", () => {
    state.isFollowing = true;
    render(<FollowButton userId="them" />);
    expect(screen.getByRole("button", { name: "Following" })).toBeTruthy();
  });

  it("is disabled while a request is in flight", () => {
    state.pending = true;
    render(<FollowButton userId="them" />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows nothing on your own profile, and a sign-in link when signed out", () => {
    const own = render(<FollowButton userId="me" />);
    expect(own.container.textContent).toBe("");
    own.unmount();
    auth.user = null;
    render(<FollowButton userId="them" />);
    expect(screen.getByRole("link").textContent).toContain("Follow");
  });
});

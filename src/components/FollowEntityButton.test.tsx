// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const auth = { user: { id: "me" } as { id: string } | null };
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }));

const toggle = vi.fn();
let state = { following: false, followers: 3 as number | null, pending: false, loading: false };
vi.mock("@/lib/entity-follows", () => ({ useEntityFollow: () => ({ ...state, toggle }) }));

import { EntityFollowerCount, FollowEntityButton } from "./FollowEntityButton";

afterEach(() => {
  cleanup();
  toggle.mockReset();
  auth.user = { id: "me" };
  state = { following: false, followers: 3, pending: false, loading: false };
});

describe("FollowEntityButton", () => {
  it("offers Follow and toggles on tap", () => {
    render(<FollowEntityButton kind="team" id="t1" name="Lakeside FC" />);
    const b = screen.getByRole("button", { name: "Follow Lakeside FC" });
    expect(b.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(b);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("says Following once saved, and a tap unfollows", () => {
    state.following = true;
    render(<FollowEntityButton kind="team" id="t1" name="Lakeside FC" />);
    const b = screen.getByRole("button", { name: /Following Lakeside FC/ });
    expect(b.textContent).toContain("Following");
    expect(b.getAttribute("aria-pressed")).toBe("true");
  });

  it("is disabled while loading or saving", () => {
    state.pending = true;
    render(<FollowEntityButton kind="org" id="o1" name="Gym" />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends a signed-out viewer to sign in instead of a dead button", () => {
    auth.user = null;
    render(<FollowEntityButton kind="team" id="t1" name="Lakeside FC" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Sign in to follow Lakeside FC" }).getAttribute("href"),
    ).toBe("/auth");
  });
});

describe("EntityFollowerCount", () => {
  it("shows the count only, singular and plural", () => {
    const one = render(<EntityFollowerCount kind="team" id="t1" />);
    expect(one.container.textContent).toBe("3 followers");
    one.unmount();
    state.followers = 1;
    expect(render(<EntityFollowerCount kind="team" id="t1" />).container.textContent).toBe(
      "1 follower",
    );
  });

  it("shows nothing until the count is known", () => {
    state.followers = null;
    expect(render(<EntityFollowerCount kind="team" id="t1" />).container.textContent).toBe("");
  });
});

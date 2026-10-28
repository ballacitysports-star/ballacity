// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  canGoBack: true,
  back: vi.fn(),
  navigate: vi.fn(),
  user: { id: "u1" } as { id: string } | null,
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    history: { canGoBack: () => h.canGoBack, back: h.back },
    navigate: h.navigate,
  }),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: h.user }) }));

import { BackButton } from "./BackButton";

beforeEach(() => {
  h.canGoBack = true;
  h.user = { id: "u1" };
  h.back.mockClear();
  h.navigate.mockClear();
});
afterEach(cleanup);

describe("BackButton", () => {
  it("returns to where the member came from (a notification, the inbox, a profile)", () => {
    render(<BackButton fallbackTo="/feed" />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(h.back).toHaveBeenCalledTimes(1);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("goes to the section page when the page was opened cold (a shared link)", () => {
    h.canGoBack = false;
    render(<BackButton fallbackTo="/teams" />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(h.back).not.toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledWith({ to: "/teams", replace: true });
  });

  it("falls back to the feed for a member and the home page for a visitor", () => {
    h.canGoBack = false;
    const { unmount } = render(<BackButton />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(h.navigate).toHaveBeenLastCalledWith({ to: "/feed", replace: true });
    unmount();
    h.user = null;
    render(<BackButton />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(h.navigate).toHaveBeenLastCalledWith({ to: "/", replace: true });
  });

  it("has an accessible name and can sit on a cover photo", () => {
    render(<BackButton variant="overlay" label="Back to game" />);
    const b = screen.getByRole("button", { name: "Back to game" });
    expect(b.className).toContain("backdrop-blur");
    expect(b.className).toContain("border");
  });
});

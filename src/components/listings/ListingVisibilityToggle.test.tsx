// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const hook = vi.hoisted(() => ({
  data: undefined as undefined | { ownerHidden: boolean; moderatorHidden: boolean },
  mutateAsync: vi.fn(async (_hidden: boolean) => ({ stillHidden: false })),
}));
vi.mock("@/lib/use-listing-visibility", () => ({
  useListingVisibility: () => ({ data: hook.data }),
  useSetListingHidden: () => ({ mutateAsync: hook.mutateAsync, isPending: false }),
}));

import { ListingVisibilityToggle } from "./ListingVisibilityToggle";

afterEach(() => {
  cleanup();
  hook.data = undefined;
  hook.mutateAsync.mockClear();
});

describe("ListingVisibilityToggle", () => {
  it("renders nothing for someone who cannot read the hide state", () => {
    const { container } = render(<ListingVisibilityToggle kind="game" id="g1" />);
    expect(container.firstChild).toBeNull();
  });

  it("asks before hiding, and says who can still see it", async () => {
    hook.data = { ownerHidden: false, moderatorHidden: false };
    render(<ListingVisibilityToggle kind="game" id="g1" />);
    expect(screen.getByText("Visible to everyone")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Hide from public/ }));
    expect(hook.mutateAsync).not.toHaveBeenCalled();
    expect(await screen.findByText(/players who joined/i)).toBeTruthy();
    expect(screen.getByText(/does not cancel the game/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(hook.mutateAsync).toHaveBeenCalledWith(true));
  });

  it("shows a hidden listing again in one tap, no confirmation", async () => {
    hook.data = { ownerHidden: true, moderatorHidden: false };
    render(<ListingVisibilityToggle kind="gym" id="x" />);
    expect(screen.getByText("Hidden from the public")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Show to everyone/ }));
    await waitFor(() => expect(hook.mutateAsync).toHaveBeenCalledWith(false));
  });

  it("offers no button when moderators hid it, and points to support", () => {
    hook.data = { ownerHidden: true, moderatorHidden: true };
    render(<ListingVisibilityToggle kind="team" id="t1" />);
    expect(screen.getByText("Hidden by BallaCity moderators")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Contact support" })).toBeTruthy();
  });

  it("uses a state it is given instead of asking", () => {
    render(
      <ListingVisibilityToggle
        kind="post"
        id="p1"
        variant="icon"
        state={{ ownerHidden: true, moderatorHidden: false }}
      />,
    );
    expect(screen.getByRole("button", { name: "Show to everyone: post" })).toBeTruthy();
  });

  it("the icon variant draws nothing for a moderator-held post", () => {
    const { container } = render(
      <ListingVisibilityToggle
        kind="post"
        id="p1"
        variant="icon"
        state={{ ownerHidden: false, moderatorHidden: true }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

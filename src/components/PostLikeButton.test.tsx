// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The page being viewed, which a sign-in link should bring the visitor back to.
const here = vi.hoisted(() => ({ href: "/highlights?clip=c1" }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    search?: { next?: string };
  }) => (
    <a href={search?.next ? `${to}?next=${encodeURIComponent(search.next)}` : to} {...rest}>
      {children}
    </a>
  ),
  useLocation: ({ select }: { select: (l: { href: string }) => unknown }) => select(here),
}));
const auth = { user: { id: "me" } as { id: string } | null };
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

const listReactions = vi.fn();
const listMyReactions = vi.fn();
const toggleReaction = vi.fn();
vi.mock("@/lib/post-engagement.functions", () => ({
  listReactions: "listReactions",
  listMyReactions: "listMyReactions",
  toggleReaction: "toggleReaction",
}));
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (name: string) =>
    ({ listReactions, listMyReactions, toggleReaction })[name as "listReactions"],
}));

import { LIKE_EMOJI, PostLikeButton } from "./PostLikeButton";

function renderButton() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PostLikeButton subjectType="team_post" subjectId="p1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listReactions.mockResolvedValue([{ emoji: LIKE_EMOJI, count: 3, mine: false }]);
  listMyReactions.mockResolvedValue([]);
  toggleReaction.mockResolvedValue({ active: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  auth.user = { id: "me" };
});

describe("PostLikeButton", () => {
  it("shows the real like count and saves a ❤️ reaction on tap", async () => {
    renderButton();
    const b = await screen.findByRole("button", { name: "Like" });
    await waitFor(() => expect(b.textContent).toBe("3"));
    expect(b.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => expect((b as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(b);
    await waitFor(() =>
      expect(toggleReaction).toHaveBeenCalledWith({
        data: { subjectType: "team_post", subjectId: "p1", emoji: LIKE_EMOJI },
      }),
    );
  });

  it("shows Unlike when the viewer already liked it", async () => {
    listMyReactions.mockResolvedValue([LIKE_EMOJI]);
    renderButton();
    const b = await screen.findByRole("button", { name: "Unlike" });
    expect(b.getAttribute("aria-pressed")).toBe("true");
  });

  it("tells the viewer when the database refuses the reaction", async () => {
    toggleReaction.mockRejectedValue(new Error("new row violates row-level security policy"));
    renderButton();
    const b = await screen.findByRole("button", { name: "Like" });
    await waitFor(() => expect((b as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(b);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("You can't react to this post."));
  });

  it("sends a signed-out viewer to sign in", async () => {
    auth.user = null;
    renderButton();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in to like" }).getAttribute("href")).toBe(
      `/auth?next=${encodeURIComponent("/highlights?clip=c1")}`,
    );
    expect(listMyReactions).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/UserAvatar", () => ({ UserAvatar: () => <span /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const person = (id: string, name: string) => ({
  id,
  display_name: name,
  username: null,
  avatar_url: null,
  avatar_initials: null,
});
const listFollowRequests = vi.fn();
const listFollows = vi.fn();
const respondToFollowRequest = vi.fn();
const removeFollower = vi.fn();
vi.mock("@/lib/follows", () => ({
  listFollowRequests: (...a: unknown[]) => listFollowRequests(...a),
  listFollows: (...a: unknown[]) => listFollows(...a),
  respondToFollowRequest: (...a: unknown[]) => respondToFollowRequest(...a),
  removeFollower: (...a: unknown[]) => removeFollower(...a),
}));

import { toast } from "sonner";
import { FollowRequestsPanel } from "./FollowRequestsPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPanel(props: Partial<Parameters<typeof FollowRequestsPanel>[0]> = {}) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FollowRequestsPanel targetUserId="owner" {...props} />
    </QueryClientProvider>,
  );
}

describe("FollowRequestsPanel", () => {
  it("lists waiting requests and approves one for the account", async () => {
    listFollowRequests.mockResolvedValue([
      { ...person("r1", "Riley Fan"), requestedAt: "2026-10-20T00:00:00Z" },
    ]);
    respondToFollowRequest.mockResolvedValue(undefined);
    renderPanel();
    await screen.findByText("Riley Fan");
    expect(listFollowRequests).toHaveBeenCalledWith("owner");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(respondToFollowRequest).toHaveBeenCalledWith("r1", "owner", true));
  });

  it("declines, and the guardian view names the child it is for", async () => {
    listFollowRequests.mockResolvedValue([
      { ...person("r2", "Sam Coach"), requestedAt: "2026-10-20T00:00:00Z" },
    ]);
    respondToFollowRequest.mockResolvedValue(undefined);
    renderPanel({ targetUserId: "child", who: "Alex" });
    await screen.findByText("Sam Coach");
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(respondToFollowRequest).toHaveBeenCalledWith("r2", "child", false));
  });

  it("says so when nobody is waiting, naming whose account it is", async () => {
    listFollowRequests.mockResolvedValue([]);
    renderPanel({ targetUserId: "child", who: "Alex" });
    await screen.findByText(/No one is waiting to follow Alex/);
  });

  it("shows the database's refusal instead of failing silently", async () => {
    listFollowRequests.mockResolvedValue([
      { ...person("r1", "Riley Fan"), requestedAt: "2026-10-20T00:00:00Z" },
    ]);
    respondToFollowRequest.mockRejectedValue(
      new Error("You can't change this account's followers."),
    );
    renderPanel();
    await screen.findByText("Riley Fan");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("You can't change this account's followers."),
    );
  });

  it("lists followers with Remove only when asked, and removes one", async () => {
    listFollowRequests.mockResolvedValue([]);
    listFollows.mockResolvedValue({
      users: [{ ...person("f1", "Fran Follower"), viewerFollows: false }],
      nextCursor: null,
    });
    removeFollower.mockResolvedValue(undefined);
    const { unmount } = renderPanel();
    await screen.findByText(/No one is waiting/);
    expect(listFollows).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    unmount();

    renderPanel({ showFollowers: true });
    await screen.findByText("Fran Follower");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeFollower).toHaveBeenCalledWith("owner", "f1"));
  });
});

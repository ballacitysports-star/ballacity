// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const state = {
  enabled: true,
  user: { id: "me" } as { id: string } | null,
  age: 30 as number | null,
  teams: [] as Array<{ teamId: string; name: string }>,
};
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/lib/use-my-age", () => ({ useMyAge: () => ({ age: state.age, loading: false }) }));
vi.mock("@/lib/team-roster", () => ({ useMyTeamMemberships: () => ({ data: state.teams }) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/lib/network-posts.functions", () => ({ createNetworkPost: vi.fn() }));
vi.mock("@/components/reels/HighlightsStrip", () => ({ HighlightsStrip: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/lib/network-posts", async () => {
  const rules = await vi.importActual<typeof import("@/lib/network-posts-rules")>(
    "@/lib/network-posts-rules",
  );
  return {
    ...rules,
    FEED_PAGE_SIZE: 20,
    useNetworkPostsEnabled: () => state.enabled,
    listFeedPosts: vi.fn().mockResolvedValue([]),
    listFollowingPosts: vi.fn().mockResolvedValue([]),
    deletePost: vi.fn(),
  };
});

import { NetworkPostsSection, PostComposer } from "./NetworkPostsSection";

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
const options = () =>
  Array.from((screen.getByLabelText("Who sees it") as HTMLSelectElement).options).map(
    (o) => o.textContent,
  );

beforeEach(() => {
  state.enabled = true;
  state.user = { id: "me" };
  state.age = 30;
  state.teams = [];
});
afterEach(cleanup);

describe("NetworkPostsSection", () => {
  it("renders nothing while the flag is off", () => {
    state.enabled = false;
    expect(wrap(<NetworkPostsSection />).container.textContent).toBe("");
  });

  it("renders nothing for a signed-out visitor", () => {
    state.user = null;
    expect(wrap(<NetworkPostsSection />).container.textContent).toBe("");
  });

  it("shows the composer and the list when on", async () => {
    wrap(<NetworkPostsSection />);
    expect(screen.getByRole("heading", { name: "Posts" })).toBeTruthy();
    expect(await screen.findByText(/No posts yet/)).toBeTruthy();
  });
});

describe("Following tab", () => {
  it("switches the list to posts from people you follow", async () => {
    const mod = await import("@/lib/network-posts");
    wrap(<NetworkPostsSection />);
    await screen.findByText(/No posts yet/);
    fireEvent.click(screen.getByRole("tab", { name: "Following" }));
    expect(
      await screen.findByText("Nothing yet from people, teams or venues you follow."),
    ).toBeTruthy();
    expect(mod.listFollowingPosts).toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Following" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });
});

describe("PostComposer audiences", () => {
  it("offers an adult everyone, followers and family, and team only with a team", () => {
    wrap(<PostComposer />);
    expect(options()).toEqual(["Everyone", "Followers", "Family"]);
    cleanup();
    state.teams = [{ teamId: "t1", name: "Harbor FC" }];
    wrap(<PostComposer />);
    expect(options()).toEqual(["Everyone", "Followers", "My team", "Family"]);
  });

  it("offers a 16-17 year old no public audience", () => {
    state.age = 17;
    wrap(<PostComposer />);
    expect(options()).toEqual(["Followers", "Family"]);
  });

  it("offers a 13-15 year old team and family only", () => {
    state.age = 14;
    state.teams = [{ teamId: "t1", name: "Harbor FC" }];
    wrap(<PostComposer />);
    expect(options()).toEqual(["My team", "Family"]);
  });

  it("does not offer posting under 13 or without a date of birth", () => {
    state.age = 11;
    wrap(<PostComposer />);
    expect(screen.getByText("Posting isn't available for your account.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    cleanup();
    state.age = null;
    wrap(<PostComposer />);
    expect(screen.getByText("Posting isn't available for your account.")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const report = vi.hoisted(() => ({ post: vi.fn(), submit: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/moderation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/moderation")>()),
  reportPost: report.post,
  submitReport: report.submit,
}));
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

import { NetworkPostsSection, PostComposer, canReportPost } from "./NetworkPostsSection";
import type { FeedPost } from "@/lib/network-posts";

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
  report.post.mockReset().mockResolvedValue("report-1");
  report.submit.mockReset();
});

const feedPost = (over: Partial<FeedPost>): FeedPost => ({
  id: "post-1",
  authorId: "someone",
  postedAs: "person",
  teamId: null,
  orgId: null,
  audience: "public",
  body: "Open run Saturday",
  moderationStatus: "approved",
  createdAt: "2026-11-27T10:00:00Z",
  authorName: "Jordan",
  authorAvatar: null,
  ...over,
});

async function showFeed(posts: FeedPost[]) {
  const mod = await import("@/lib/network-posts");
  vi.mocked(mod.listFeedPosts).mockResolvedValueOnce(posts);
  wrap(<NetworkPostsSection />);
  await screen.findByText(posts[0].body);
}
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

describe("Reporting a post (20261205100000)", () => {
  it("offers Report on someone else's post, not on your own", async () => {
    await showFeed([
      feedPost({ id: "theirs", authorId: "someone", authorName: "Jordan", body: "Their post" }),
      feedPost({ id: "mine", authorId: "me", authorName: "Me", body: "My post" }),
    ]);
    expect(screen.getByRole("button", { name: "Report post by Jordan" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Report post by Me" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Report post/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Delete post" })).toBeTruthy();
  });

  it("reports the post by its id through report_post, with the reason picked", async () => {
    await showFeed([feedPost({ id: "post-42", authorId: "someone", authorName: "Jordan" })]);
    fireEvent.click(screen.getByRole("button", { name: "Report post by Jordan" }));
    expect(await screen.findByText("Report post")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Harassment" }));
    fireEvent.change(screen.getByLabelText("Additional details (optional)"), {
      target: { value: "Keeps posting about me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
    await waitFor(() => expect(report.post).toHaveBeenCalledTimes(1));
    expect(report.post).toHaveBeenCalledWith("post-42", "harassment", "Keeps posting about me");
    expect(report.submit).not.toHaveBeenCalled();
    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Report submitted. Our moderators will review it.",
      ),
    );
  });

  it("shows report_post's refusal as the sentence it already is", async () => {
    report.post.mockRejectedValueOnce(new Error("That post isn't available."));
    await showFeed([feedPost({ authorName: "Jordan" })]);
    fireEvent.click(screen.getByRole("button", { name: "Report post by Jordan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Spam" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That post isn't available."));
  });

  it("is shown only for a network post by someone else, to someone signed in", () => {
    expect(canReportPost(feedPost({ authorId: "someone" }), "me")).toBe(true);
    expect(canReportPost(feedPost({ authorId: "me" }), "me")).toBe(false);
    expect(canReportPost(feedPost({ authorId: "someone" }), null)).toBe(false);
    // A team announcement merged into Following is a team post, not a network post.
    expect(canReportPost(feedPost({ id: "news-7", authorId: "" }), "me")).toBe(false);
    expect(canReportPost(feedPost({ id: "news-7", authorId: "someone" }), "me")).toBe(false);
  });

  it("is not there for a signed-out visitor, who sees no feed", () => {
    state.user = null;
    wrap(<NetworkPostsSection />);
    expect(screen.queryByRole("button", { name: /^Report post/ })).toBeNull();
  });
});

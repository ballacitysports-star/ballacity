// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/components/PostLikeButton", () => ({
  PostLikeButton: ({ subjectId }: { subjectId: string }) => (
    <button type="button" data-subject={subjectId}>
      Like
    </button>
  ),
}));
vi.mock("@/components/ResponsiveImage", () => ({
  ResponsiveImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import { PostCard } from "./PostCard";
import type { OrgPost } from "@/lib/sample-data";

afterEach(cleanup);

const tryout: OrgPost = {
  id: "p9",
  kind: "tryout",
  title: "Fall tryouts",
  body: "Bring water",
  date: "2026-11-20T14:00:00Z",
  postedAt: "2026-11-01T14:00:00Z",
  location: "North gym",
};

describe("PostCard controls", () => {
  it("likes through the real reaction button for this post", () => {
    render(<PostCard post={tryout} onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Like" }).getAttribute("data-subject")).toBe("p9");
  });

  it("has no Save or Share control that does nothing", () => {
    render(<PostCard post={tryout} onClick={() => {}} />);
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /share/i })).toBeNull();
  });

  it("keeps Comment and the event's Apply action", () => {
    render(<PostCard post={tryout} onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Comment" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
  });
});

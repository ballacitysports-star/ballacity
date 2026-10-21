// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/components/ResponsiveImage", () => ({
  ResponsiveImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import { PostCard } from "./PostCard";
import type { OrgPost } from "@/lib/sample-data";

afterEach(cleanup);

const base: OrgPost = {
  id: "p1",
  kind: "announcement",
  title: "Season opener Saturday",
  body: "",
  date: "2026-10-24T14:00:00Z",
  postedAt: "2026-10-20T14:00:00Z",
};

describe("PostCard image", () => {
  it("shows the post's picture with the title over it", () => {
    const { container } = render(<PostCard post={{ ...base, imageUrl: "https://cdn/x.jpg" }} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn/x.jpg");
    expect(screen.getByRole("heading", { name: "Season opener Saturday" })).toBeTruthy();
  });

  it("keeps the emoji placeholder for a post without a picture", () => {
    const { container } = render(<PostCard post={base} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { name: "Season opener Saturday" })).toBeTruthy();
    expect(container.textContent).toContain("📣");
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ModerationPost } from "@/lib/moderation.functions";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode;
    to: string;
    params: Record<string, string>;
  }) => (
    <a href={Object.entries(params).reduce((href, [k, v]) => href.replace(`$${k}`, v), to)}>
      {children}
    </a>
  ),
}));

import { ReportedPostEvidence, reportedPostState } from "./ReportedPostEvidence";

const post = (over: Partial<ModerationPost> = {}): ModerationPost => ({
  id: "post-1",
  body: "Tryouts Sunday at 6",
  postedAs: "person",
  teamId: null,
  orgId: null,
  audience: "followers",
  hidden: false,
  deleted: false,
  moderationStatus: "approved",
  editedSinceReport: false,
  restoreKeepsHidden: null,
  ...over,
});

const show = (postId: string | null, p: ModerationPost | null) =>
  render(
    <dl>
      <ReportedPostEvidence postId={postId} post={p} />
    </dl>,
  );

afterEach(cleanup);

describe("ReportedPostEvidence (moderation queue, post reports)", () => {
  it("shows the post's text and who could read it", () => {
    show("post-1", post());
    expect(screen.getByText("Network post, as it is now")).toBeTruthy();
    expect(screen.getByText("Tryouts Sunday at 6")).toBeTruthy();
    expect(screen.getByText(/Shared with: Followers/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("links a team's post to the team and a venue's post to the venue", () => {
    show("post-1", post({ postedAs: "team", teamId: "harbor-fc" }));
    expect(screen.getByRole("link", { name: "Posted as a team" }).getAttribute("href")).toBe(
      "/teams/harbor-fc",
    );
    cleanup();
    show("post-1", post({ postedAs: "org", orgId: "gym-9" }));
    expect(screen.getByRole("link", { name: "Posted as a venue" }).getAttribute("href")).toBe(
      "/orgs/gym-9",
    );
  });

  it("says where the post stands before a moderator acts", () => {
    expect(reportedPostState(post())).toBeNull();
    expect(reportedPostState(post({ hidden: true }))).toBe("hidden");
    expect(reportedPostState(post({ deleted: true, moderationStatus: "held" }))).toBe(
      "deleted by its author, held by the screen",
    );
    show("post-1", post({ hidden: true }));
    expect(screen.getByText(/Shared with: Followers · hidden/)).toBeTruthy();
  });

  it("keeps the report readable once the post was deleted for good, without naming who deleted it", () => {
    show(null, null);
    expect(screen.getByText("(the post was deleted for good)")).toBeTruthy();
    expect(screen.queryByText(/author/)).toBeNull();
  });

  it("says when the text was edited after the report, and when nobody can tell", () => {
    show("post-1", post());
    expect(screen.queryByText(/Edited after this report/)).toBeNull();
    expect(screen.queryByText(/did not record the text/)).toBeNull();
    cleanup();
    show("post-1", post({ body: "Have a nice day", editedSinceReport: true }));
    expect(
      screen.getByText("Edited after this report: this is not the text that was reported."),
    ).toBeTruthy();
    cleanup();
    show("post-1", post({ editedSinceReport: null }));
    expect(screen.getByText(/did not record the text it was about/)).toBeTruthy();
  });

  it("says before Restore runs that it would leave a hidden post hidden, and why", () => {
    show("post-1", post({ hidden: true }));
    expect(screen.queryByText(/leaves the post hidden/)).toBeNull();
    cleanup();
    show(
      "post-1",
      post({ hidden: true, restoreKeepsHidden: "another report about this post was acted on" }),
    );
    expect(
      screen.getByText(
        /Restore lifts the author's suspension or ban and dismisses this report, but leaves the post hidden: another report about this post was acted on\./,
      ),
    ).toBeTruthy();
  });
});

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
import { RESTORE_CHECK_FAILED, RESTORE_KEEPS_HIDDEN, restoreKeepsHidden } from "@/lib/post-restore";

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
    show("post-1", post({ hidden: true, restoreKeepsHidden: RESTORE_KEEPS_HIDDEN.hiddenSince }));
    expect(
      screen.getByText(
        "Restore leaves the post hidden: it was hidden again, or this report was updated, after this report hid it. A superadmin unhides it on /superadmin, Content, Network posts.",
      ),
    ).toBeTruthy();
    // Restore on a post report lifts only this report's own suspension or ban: the card never promises a lift
    expect(screen.queryByText(/lifts the author's suspension or ban/)).toBeNull();
  });

  describe("what it says before Restore, from the same rule Restore runs (post-restore.ts)", () => {
    /** This report's Remove content: hidden_at and reviewed_at from one `now`, as PostgREST returns them. */
    const T_MINE = "2026-11-27T11:00:00.123+00:00";
    const T_LATER = "2026-11-27T12:30:00.456+00:00";
    const own: Parameters<typeof restoreKeepsHidden>[0] = {
      resolutionNotes: "Post hidden — abuse",
      reviewedAt: T_MINE,
      hiddenAt: T_MINE,
      ownHides: [],
      otherReports: 0,
    };
    const card = (over: Partial<typeof own>) => {
      const input = { ...own, ...over };
      show(
        "post-1",
        post({ hidden: !!input.hiddenAt, restoreKeepsHidden: restoreKeepsHidden(input) }),
      );
    };
    const warning = (why: string) =>
      `Restore leaves the post hidden: ${why}. A superadmin unhides it on /superadmin, Content, Network posts.`;
    /** Another report keeps this report's own hide: Restore is refused and the report stays as it is. */
    const refusal =
      "Restore changes nothing while another report about this post was acted on: this report's own hide stays, and so does the report. Dismiss that report first if its action no longer applies.";

    it("warns of nothing when this report's own hide is the one Restore would undo", () => {
      card({});
      expect(screen.getByText(/Shared with: Followers · hidden/)).toBeTruthy();
      expect(screen.queryByText(/leaves the post hidden/)).toBeNull();
    });

    it("warns that a later superadmin hide stays", () => {
      card({ hiddenAt: T_LATER });
      expect(screen.getByText(warning(RESTORE_KEEPS_HIDDEN.hiddenSince))).toBeTruthy();
    });

    it("warns that another moderator's later hide through another report stays", () => {
      card({ hiddenAt: T_LATER, otherReports: 1 });
      expect(screen.getByText(warning(RESTORE_KEEPS_HIDDEN.hiddenSince))).toBeTruthy();
    });

    it("says Restore changes nothing, and keeps the report, while another report keeps this report's own hide", () => {
      card({ otherReports: 1 });
      expect(screen.getByText(refusal)).toBeTruthy();
      expect(screen.queryByText(/leaves the post hidden/)).toBeNull();
    });

    it("knows this report's own hide after a second action, from its audit entry", () => {
      card({ resolutionNotes: "Warning issued — abuse", reviewedAt: T_LATER, ownHides: [T_MINE] });
      expect(screen.queryByText(/leaves the post hidden|changes nothing/)).toBeNull();
    });

    it("warns that a hide that was there before this report's Remove content stays", () => {
      card({ resolutionNotes: "Post already hidden — abuse" });
      expect(screen.getByText(warning(RESTORE_KEEPS_HIDDEN.alreadyHidden))).toBeTruthy();
    });

    it("says when it could not check what Restore would keep", () => {
      show("post-1", post({ hidden: true, restoreKeepsHidden: RESTORE_CHECK_FAILED }));
      expect(screen.getByText(RESTORE_CHECK_FAILED)).toBeTruthy();
    });

    it("warns that a hide this report's notes do not claim stays", () => {
      card({ resolutionNotes: "Warning issued — abuse" });
      expect(screen.getByText(warning(RESTORE_KEEPS_HIDDEN.notThisReport))).toBeTruthy();
    });

    it("warns that the post stays hidden once this report's reviewed_at changed after its hide", () => {
      card({ reviewedAt: T_LATER });
      expect(screen.getByText(warning(RESTORE_KEEPS_HIDDEN.hiddenSince))).toBeTruthy();
    });

    it("warns of nothing for a post that is already visible", () => {
      card({ hiddenAt: null, resolutionNotes: null });
      expect(screen.queryByText(/leaves the post hidden/)).toBeNull();
      expect(screen.queryByText(/hidden/)).toBeNull();
    });
  });
});

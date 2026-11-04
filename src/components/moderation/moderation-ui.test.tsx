// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const auth = { user: null as null | { id: string } };
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }));

const reportDialogProps: Record<string, unknown>[] = [];
vi.mock("@/components/ReportDialog", () => ({
  ReportDialog: (p: Record<string, unknown>) => {
    reportDialogProps.push(p);
    return p.open ? <div data-testid="report-dialog" /> : null;
  },
}));

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
const appeal = vi.fn();
vi.mock("@/lib/moderation", () => ({
  appealContentDecision: (...a: unknown[]) => appeal(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ReportContentButton } from "./ReportContentButton";
import { ContentUnderReview } from "./ContentUnderReview";

beforeEach(() => {
  auth.user = null;
  reportDialogProps.length = 0;
  rpc.mockReset();
  appeal.mockReset();
});
afterEach(cleanup);

describe("ReportContentButton", () => {
  const base = { kind: "team_post" as const, contentId: "p1", authorId: "author", label: "Post" };

  it("is not shown when signed out", () => {
    render(<ReportContentButton {...base} />);
    expect(screen.queryByRole("button", { name: /report/i })).toBeNull();
  });
  it("is not shown on your own content", () => {
    auth.user = { id: "author" };
    render(<ReportContentButton {...base} />);
    expect(screen.queryByRole("button", { name: /report/i })).toBeNull();
  });
  it("is not shown when the author is unknown", () => {
    auth.user = { id: "someone" };
    render(<ReportContentButton {...base} authorId={null} />);
    expect(screen.queryByRole("button", { name: /report/i })).toBeNull();
  });
  it("opens the report dialog with the post id for someone else's post", () => {
    auth.user = { id: "someone" };
    render(<ReportContentButton {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /report post/i }));
    expect(screen.getByTestId("report-dialog")).toBeTruthy();
    const last = reportDialogProps.at(-1)!;
    expect(last.subjectType).toBe("team_post");
    expect(last.teamPostId).toBe("p1");
    expect(last.commentId).toBeNull();
  });
  it("sends the comment id for a comment", () => {
    auth.user = { id: "someone" };
    render(<ReportContentButton kind="comment" contentId="c1" authorId="author" label="hi" />);
    fireEvent.click(screen.getByRole("button", { name: /report comment/i }));
    const last = reportDialogProps.at(-1)!;
    expect(last.subjectType).toBe("comment");
    expect(last.commentId).toBe("c1");
    expect(last.teamPostId).toBeNull();
  });
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ContentUnderReview", () => {
  const held = {
    content_type: "team_post",
    content_id: "p1",
    label: "Practice notes",
    level: "held",
    held_at: "2026-11-05T00:00:00Z",
    has_open_appeal: false,
  };

  it("asks the database only for the viewer's own holds in the author view", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    wrap(<ContentUnderReview scope="mine" viewerId="u1" />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0][0]).toBe("my_content_holds");
  });
  it("uses the guardian function in the guardian view", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    wrap(<ContentUnderReview scope="children" viewerId="g1" childNames={{}} />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0][0]).toBe("guardian_content_holds");
  });
  it("renders nothing when nothing is held", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { container } = wrap(<ContentUnderReview scope="mine" viewerId="u1" />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
  it("lets the author ask for a review with a note", async () => {
    rpc.mockResolvedValue({ data: [held], error: null });
    appeal.mockResolvedValue(undefined);
    wrap(<ContentUnderReview scope="mine" viewerId="u1" />);
    fireEvent.click(await screen.findByRole("button", { name: /ask for a review/i }));
    const send = await screen.findByRole("button", { name: /^send$/i });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/what would you like/i), {
      target: { value: "It was a normal notice" },
    });
    fireEvent.click(send);
    await waitFor(() =>
      expect(appeal).toHaveBeenCalledWith("team_post", "p1", "It was a normal notice"),
    );
  });
  it("shows that a review was already requested instead of a second button", async () => {
    rpc.mockResolvedValue({ data: [{ ...held, has_open_appeal: true }], error: null });
    wrap(<ContentUnderReview scope="mine" viewerId="u1" />);
    expect(await screen.findByText(/review requested/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /ask for a review/i })).toBeNull();
  });
  it("names the child in the guardian view", async () => {
    rpc.mockResolvedValue({ data: [{ ...held, child_user_id: "k1" }], error: null });
    wrap(<ContentUnderReview scope="children" viewerId="g1" childNames={{ k1: "Sam" }} />);
    expect(await screen.findByText(/Sam:/)).toBeTruthy();
  });
});

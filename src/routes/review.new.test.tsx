// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  txns: [] as unknown[],
  mutate: vi.fn(),
  suggest: vi.fn(),
  vote: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useSearch: () => h.search,
  }),
  useNavigate: () => h.navigate,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("@/lib/seo", () => ({ pageHead: () => ({}) }));
vi.mock("@/lib/transactions", () => ({ useTransactionsWith: () => h.txns }));
vi.mock("@/lib/reviews-db", () => ({
  useSubmitReview: () => ({ mutate: h.mutate, isPending: false }),
}));
vi.mock("@/lib/reviews.functions", () => ({ suggestReviewText: (a: unknown) => h.suggest(a) }));
vi.mock("@/lib/skill.functions", () => ({ submitSkillVote: (a: unknown) => h.vote(a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { Route } from "./review.new";

const Form = (Route as unknown as { component: () => ReactNode }).component;

const GAME = {
  id: "c1:g-1",
  counterpartyId: "u-c",
  counterpartyName: "Cy Player",
  gameId: "g-1",
  sport: "Basketball",
  context: "Sunday Run",
  date: "2026-10-18T10:00:00Z",
  closesAt: "2026-11-01T10:00:00Z",
};

beforeEach(() => {
  h.search = { revieweeId: "u-c", revieweeKind: "player", revieweeName: "Cy Player" };
  h.txns = [GAME];
  h.mutate.mockReset();
  h.suggest.mockReset();
  h.vote.mockReset().mockResolvedValue({ ok: true });
});
afterEach(cleanup);

const post = () => screen.getByRole("button", { name: /Post/ }) as HTMLButtonElement;
const body = () => screen.getByPlaceholderText(/Specifics help/) as HTMLTextAreaElement;

describe("review form", () => {
  it("asks the kind-specific headline question", () => {
    h.search = { revieweeId: "u-h", revieweeKind: "host", revieweeName: "Hana" };
    render(<Form />);
    expect(screen.getByText("Would you join their games again?")).toBeTruthy();
    expect(
      screen.getByText("The game matched the listing (time, place, level, price)"),
    ).toBeTruthy();
  });

  it("needs stars, the headline answer and a sentence before Post is enabled", () => {
    render(<Form />);
    expect(post().disabled).toBe(true);
    fireEvent.change(body(), { target: { value: "Played hard and fair all game" } });
    expect(post().disabled).toBe(true); // still no stars or headline answer
    fireEvent.click(screen.getByLabelText("4 stars"));
    expect(post().disabled).toBe(true); // still no headline answer
    const headline = screen.getByRole("group", { name: "Would you do this again?" });
    fireEvent.click(within(headline).getByRole("button", { name: "Not sure" }));
    expect(post().disabled).toBe(false);
  });

  it("sends the headline answer, quick answers and tags (and no old slider scores)", () => {
    render(<Form />);
    fireEvent.click(screen.getByLabelText("5 stars"));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Would you do this again?" })).getByRole("button", {
        name: "Yes",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("group", { name: "Respectful to everyone" })).getByRole("button", {
        name: "Mostly",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("group", { name: "Played fair and accepted calls" })).getByRole(
        "button",
        {
          name: "Yes",
        },
      ),
    );
    const tags = screen.getByRole("group", { name: "Praise tags" });
    fireEvent.click(within(tags).getByRole("button", { name: "Plays fair" }));
    fireEvent.click(within(tags).getByRole("button", { name: "Always on time" }));
    fireEvent.change(body(), { target: { value: "Played hard and fair all game" } });
    fireEvent.click(post());

    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate.mock.calls[0][0]).toMatchObject({
      kind: "player",
      revieweeKind: "player",
      revieweeId: "u-c",
      gameId: "g-1",
      rating: 5,
      recommend: "yes",
      answers: { respect: "mostly", fair: "yes" },
      tags: ["fairPlay", "onTime"],
      scores: {},
    });
  });

  it("lets a tapped answer be un-tapped", () => {
    render(<Form />);
    const q = screen.getByRole("group", { name: "Played as a teammate" });
    const yes = within(q).getByRole("button", { name: "Yes" });
    fireEvent.click(yes);
    expect(yes.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(yes);
    expect(yes.getAttribute("aria-pressed")).toBe("false");
  });

  it("stops at 5 tags and re-enables when one is removed", () => {
    render(<Form />);
    const group = screen.getByRole("group", { name: "Praise tags" });
    const buttons = within(group).getAllByRole("button");
    buttons.slice(0, 5).forEach((b) => fireEvent.click(b));
    const sixth = buttons[5] as HTMLButtonElement;
    expect(sixth.disabled).toBe(true);
    fireEvent.click(buttons[0]);
    expect(sixth.disabled).toBe(false);
  });

  it("warns that a 'No' on a safety question also goes to moderators — only for those questions", () => {
    h.search = { revieweeId: "u-h", revieweeKind: "host", revieweeName: "Hana" };
    render(<Form />);
    expect(screen.queryByText(/sent privately to our moderators/)).toBeNull();
    fireEvent.click(
      within(screen.getByRole("group", { name: "Felt safe and well run" })).getByRole("button", {
        name: "No",
      }),
    );
    expect(screen.getByText(/sent privately to our moderators/)).toBeTruthy();
    // a "No" on a non-safety question doesn't show the note again
    fireEvent.click(
      within(screen.getByRole("group", { name: "Fair teams and rules" })).getByRole("button", {
        name: "No",
      }),
    );
    expect(screen.getAllByText(/sent privately to our moderators/)).toHaveLength(1);
  });

  it("never shows the safety note for player reviews (no safety question there)", () => {
    render(<Form />);
    for (const q of [
      "Played fair and accepted calls",
      "Respectful to everyone",
      "Played as a teammate",
    ]) {
      fireEvent.click(
        within(screen.getByRole("group", { name: q })).getByRole("button", { name: "No" }),
      );
    }
    expect(screen.queryByText(/moderators/)).toBeNull();
  });

  it("drafts from the tags picked, and only once there are some", async () => {
    h.suggest.mockResolvedValue({ draft: "Fair, hard-working teammate." });
    render(<Form />);
    const draft = screen.getByRole("button", { name: /Draft with AI/ }) as HTMLButtonElement;
    expect(draft.disabled).toBe(true);
    fireEvent.click(
      within(screen.getByRole("group", { name: "Praise tags" })).getByRole("button", {
        name: "Plays fair",
      }),
    );
    expect(draft.disabled).toBe(false);
    fireEvent.click(draft);
    await waitFor(() => expect(body().value).toBe("Fair, hard-working teammate."));
    expect(h.suggest.mock.calls[0][0]).toMatchObject({
      data: { revieweeKind: "player", highlights: ["Plays fair"] },
    });
  });

  it("explains why nothing can be posted when there is no shared game", () => {
    h.txns = [];
    render(<Form />);
    expect(screen.getByText(/Reviews are verified-only/)).toBeTruthy();
    expect(post().disabled).toBe(true);
  });
});

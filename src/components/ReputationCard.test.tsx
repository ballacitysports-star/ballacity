// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ReputationCard } from "./ReputationCard";
import { computeReputation, type Review } from "@/lib/reviews";

afterEach(cleanup);

let n = 0;
const rv = (extra: Partial<Review> = {}): Review => {
  n += 1;
  return {
    id: `c${n}`,
    kind: "player",
    revieweeKind: "player",
    revieweeId: "x",
    revieweeName: "X",
    reviewerName: `R${n}`,
    reviewerHandle: "",
    reviewerAvatar: "RR",
    reviewerId: `cr${n}`,
    rating: 5,
    body: "great teammate to have",
    date: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    verified: true,
    ...extra,
  };
};

describe("ReputationCard", () => {
  it("shows 'New' and no what-people-say block before any review", () => {
    render(<ReputationCard rep={computeReputation([], "player")} />);
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.queryByTestId("recommend-line")).toBeNull();
  });

  it("shows the headline answer, tags and question results", () => {
    const reviews = Array.from({ length: 5 }, (_, i) =>
      rv({
        recommend: i === 4 ? "no" : "yes",
        tags: ["fairPlay"],
        answers: { fair: i === 4 ? "no" : "yes" },
      }),
    );
    render(<ReputationCard rep={computeReputation(reviews, "player")} />);
    expect(screen.getByTestId("recommend-line").textContent).toContain(
      "80% would play with them again",
    );
    expect(screen.getByText("Plays fair · 5")).toBeTruthy();
    const row = screen.getByText("Played fair and accepted calls").closest("li") as HTMLElement;
    expect(within(row).getByText("80% yes")).toBeTruthy();
  });

  it("holds back per-question percentages until 3 people have answered", () => {
    const reviews = [rv({ answers: { fair: "yes" } }), rv({ answers: { fair: "yes" } })];
    render(<ReputationCard rep={computeReputation(reviews, "player")} />);
    expect(screen.queryByText("Played fair and accepted calls")).toBeNull();
  });

  it("uses plain counts for a handful of answers", () => {
    render(
      <ReputationCard
        rep={computeReputation([rv({ recommend: "yes" }), rv({ recommend: "no" })], "host")}
      />,
    );
    expect(screen.getByTestId("recommend-line").textContent).toContain(
      "1 of 2 would join their games again",
    );
  });
});

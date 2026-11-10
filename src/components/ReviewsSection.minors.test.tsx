// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * Public profile rendering for PRIV-1: the reviews section draws nothing, and starts no review or
 * summary reads, for a person under 18, a person of unknown age or an id that is not an account.
 * Teams, trainers and adults are unaffected. (The database enforces the rule whatever this does.)
 */

let subjectIsAdult: boolean | undefined = true;
vi.mock("@/lib/review-subject", () => ({
  useReviewSubjectIsAdult: () => subjectIsAdult,
  isPersonKind: (k: string) => k === "player" || k === "host",
}));

const reads = { reviews: 0, insight: 0, canReview: 0 };
vi.mock("@/lib/reviews-db", () => ({
  useReviewsFor: () => {
    reads.reviews += 1;
    return [];
  },
  useReputationInsight: () => {
    reads.insight += 1;
    return { data: null };
  },
  useMarkHelpful: () => ({ mutate: vi.fn() }),
  useReportReview: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/transactions", () => ({
  useCanReview: () => {
    reads.canReview += 1;
    return false;
  },
}));
vi.mock("@/lib/reviews.functions", () => ({ refreshMyReputationSummary: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/ReputationCard", () => ({
  ReputationCard: () => <div data-testid="reputation-card">Trust score</div>,
}));
vi.mock("@/components/RatingExplainer", () => ({ RatingExplainer: () => null }));

import { ReviewsSection } from "./ReviewsSection";

function renderSection(kind: "player" | "host" | "team" | "trainer" = "player") {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ReviewsSection revieweeId="subject-1" revieweeKind={kind} revieweeName="Sam" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  subjectIsAdult = true;
  reads.reviews = reads.insight = reads.canReview = 0;
});
afterEach(cleanup);

describe("ReviewsSection and people under 18", () => {
  it("renders the section for an adult", () => {
    renderSection();
    expect(screen.getByRole("heading", { name: /Reviews/ })).toBeTruthy();
    expect(screen.getByTestId("reputation-card")).toBeTruthy();
    expect(reads.reviews).toBeGreaterThan(0);
  });

  for (const [label, value] of [
    ["a person under 18, or of unknown age", false],
    ["a subject whose age is still loading", undefined],
  ] as const) {
    it(`renders nothing and reads nothing for ${label}`, () => {
      subjectIsAdult = value;
      const { container } = renderSection("player");
      expect(container.textContent).toBe("");
      expect(screen.queryByTestId("reputation-card")).toBeNull();
      expect(reads).toEqual({ reviews: 0, insight: 0, canReview: 0 });
    });
  }

  it("does the same for a host", () => {
    subjectIsAdult = false;
    const { container } = renderSection("host");
    expect(container.textContent).toBe("");
    expect(reads.reviews).toBe(0);
  });

  it("shows a team's or trainer's reviews (the gate says yes for things that are not people)", () => {
    renderSection("team");
    expect(screen.getByTestId("reputation-card")).toBeTruthy();
    cleanup();
    renderSection("trainer");
    expect(screen.getByTestId("reputation-card")).toBeTruthy();
  });
});

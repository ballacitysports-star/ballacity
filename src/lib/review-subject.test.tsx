// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";

const auth: { user: { id: string } | null; loading: boolean } = { user: null, loading: false };
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }));

let profileResult: { data: { age_cohort: string } | null; error: unknown } = {
  data: { age_cohort: "adult" },
  error: null,
};
const profileReads: string[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            profileReads.push(`${table}:${id}`);
            return profileResult;
          },
        }),
      }),
    }),
  },
}));

import { useReviewSubjectIsAdult } from "@/lib/review-subject";
import { ReviewSubjectGate } from "@/components/ReviewSubjectGate";

const ID = "33333333-3333-4333-8333-333333333333";
const ME = "44444444-4444-4444-8444-444444444444";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  profileResult = { data: { age_cohort: "adult" }, error: null };
  profileReads.length = 0;
  auth.user = null;
  auth.loading = false;
});
afterEach(cleanup);

describe("useReviewSubjectIsAdult", () => {
  it("is true for a confirmed adult", async () => {
    const { result } = renderHook(() => useReviewSubjectIsAdult(ID, "player"), {
      wrapper: wrapper(),
    });
    expect(result.current).toBeUndefined(); // loading: nothing is shown yet
    await waitFor(() => expect(result.current).toBe(true));
  });

  for (const cohort of ["child_under_13", "teen_13_15", "teen_16_17", "mystery"]) {
    it(`is false for ${cohort}`, async () => {
      profileResult = { data: { age_cohort: cohort }, error: null };
      const { result } = renderHook(() => useReviewSubjectIsAdult(ID, "host"), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current).toBe(false));
    });
  }

  it("is false when the profile cannot be read (fails closed), including an error", async () => {
    profileResult = { data: null, error: null };
    const a = renderHook(() => useReviewSubjectIsAdult(ID, "player"), { wrapper: wrapper() });
    await waitFor(() => expect(a.result.current).toBe(false));
    profileResult = { data: null, error: new Error("denied") };
    const b = renderHook(() => useReviewSubjectIsAdult(ID, "player"), { wrapper: wrapper() });
    await waitFor(() => expect(b.result.current).toBe(false));
  });

  it("is false for an id that is not an account, without querying", () => {
    const { result } = renderHook(() => useReviewSubjectIsAdult("host-demo-1", "host"), {
      wrapper: wrapper(),
    });
    expect(result.current).toBe(false);
    expect(profileReads).toEqual([]);
  });

  it("is true for teams, trainers and places without querying", () => {
    for (const kind of ["team", "trainer", "gym"]) {
      const { result } = renderHook(() => useReviewSubjectIsAdult("tm-1", kind), {
        wrapper: wrapper(),
      });
      expect(result.current).toBe(true);
    }
    expect(profileReads).toEqual([]);
  });

  it('resolves "me" to the signed-in user, and waits for sign-in to settle', async () => {
    auth.loading = true;
    const loading = renderHook(() => useReviewSubjectIsAdult("me", "player"), {
      wrapper: wrapper(),
    });
    expect(loading.result.current).toBeUndefined();
    auth.loading = false;
    auth.user = { id: ME };
    profileResult = { data: { age_cohort: "teen_16_17" }, error: null };
    const { result } = renderHook(() => useReviewSubjectIsAdult("me", "player"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current).toBe(false));
    expect(profileReads).toContain(`profiles:${ME}`);
  });

  it('is false for "me" when signed out', () => {
    const { result } = renderHook(() => useReviewSubjectIsAdult("me", "player"), {
      wrapper: wrapper(),
    });
    expect(result.current).toBe(false);
  });
});

describe("ReviewSubjectGate (public profile rendering)", () => {
  const view = (id = ID, kind: "player" | "host" | "team" = "player") =>
    render(
      <ReviewSubjectGate revieweeId={id} revieweeKind={kind}>
        <div data-testid="reputation">Trust score 4.5</div>
      </ReviewSubjectGate>,
      { wrapper: wrapper() },
    );

  it("shows reviews and reputation for an adult", async () => {
    view();
    expect(await screen.findByTestId("reputation")).toBeTruthy();
  });

  it("shows nothing while the age is still loading", () => {
    view();
    expect(screen.queryByTestId("reputation")).toBeNull();
  });

  for (const cohort of ["child_under_13", "teen_13_15", "teen_16_17"]) {
    it(`shows nothing for a ${cohort} profile`, async () => {
      profileResult = { data: { age_cohort: cohort }, error: null };
      view();
      await waitFor(() => expect(profileReads.length).toBeGreaterThan(0));
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByTestId("reputation")).toBeNull();
    });
  }

  it("shows a team's reputation regardless of any person's age", () => {
    view("tm-1", "team");
    expect(screen.getByTestId("reputation")).toBeTruthy();
  });
});

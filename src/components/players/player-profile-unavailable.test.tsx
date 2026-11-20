// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// The player profile route, rendered on its own. Under RLS a nonexistent player and one
// the viewer may not see (private, or age-restricted) both come back as no row, so each
// must land on the same screen and the page never says which. (Blocks are not enforced
// by the profiles read rule today, so they are not part of this promise.)
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    options: opts,
    useParams: () => ({ userId: "u1" }),
  }),
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  Navigate: () => null,
  useNavigate: () => () => {},
}));

type QueryAnswer = { data: unknown; error: unknown };
let profileAnswer: QueryAnswer = { data: null, error: null };

function query(answer: () => QueryAnswer) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = () => Promise.resolve(answer());
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) =>
      query(() => (table === "profiles" ? profileAnswer : { data: null, error: null })),
    rpc: () => Promise.resolve({ data: [], error: null }),
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "viewer" } }) }));
vi.mock("@/lib/privacy", () => ({ usePublicPrivacyFlags: () => ({ data: undefined }) }));
vi.mock("@/lib/follows", () => ({ useFollow: () => ({}) }));
vi.mock("@/lib/reviews-db", () => ({ useReviewsFor: () => [] }));
vi.mock("@/lib/review-subject", () => ({ useReviewSubjectIsAdult: () => null }));
vi.mock("@/lib/user-prefs-store", () => ({
  useProfileOverrides: () => ({}),
  useDistanceUnit: () => "mi",
}));
vi.mock("@/components/messages/useMessageOrGuardian", () => ({
  useMessageOrGuardian: () => ({ startMessage: () => Promise.resolve() }),
}));
vi.mock("@/hooks/use-reel-realtime", () => ({ useReelRealtime: () => {} }));
vi.mock("@/lib/reels.functions", () => ({ listPublicReels: () => Promise.resolve([]) }));

import { Route } from "@/routes/players.$userId";

const PlayerProfilePage = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component;

afterEach(() => {
  cleanup();
  toastError.mockReset();
  profileAnswer = { data: null, error: null };
});

async function renderUnavailable(answer: QueryAnswer) {
  profileAnswer = answer;
  const { container } = render(<PlayerProfilePage />);
  await screen.findByText("This profile is private or unavailable.");
  return container.innerHTML;
}

describe("player profile the viewer may not see", () => {
  it("shows the private-or-unavailable screen, not 'removed'", async () => {
    await renderUnavailable({ data: null, error: null });
    expect(screen.getByRole("heading", { name: "Profile unavailable" })).toBeTruthy();
    expect(screen.queryByText(/removed|not found|blocked|minor/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Find players" }).getAttribute("href")).toBe(
      "/players",
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("renders the same screen when the lookup fails, plus a load-error toast", async () => {
    const hidden = await renderUnavailable({ data: null, error: null });
    cleanup();
    const failed = await renderUnavailable({
      data: null,
      error: { message: "TypeError: Failed to fetch" },
    });
    expect(failed).toBe(hidden);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).not.toMatch(/Failed to fetch/);
  });
});

// @vitest-environment jsdom
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * WP 4.1: My availability & invitations, one screen (/availability). Your posts, game invitations and requests
 * (MineView) with "I'm available" on top. `compose` opens posting once on arrival, and only if the posting check
 * passes; parent mode never shows it; the old `/players?tab=mine` links redirect here.
 */
const env = vi.hoisted(() => ({
  search: { compose: "" } as { compose: string },
  user: { id: "me" } as { id: string } | null,
  parentMode: false,
  parentLoading: false,
  canPost: true,
  reason: null as null | string,
  gateLoading: false,
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    options: opts,
    useSearch: () => env.search,
  }),
  useNavigate: () => env.navigate,
  useLocation: () => ({ pathname: "/availability", searchStr: "" }),
  Navigate: ({ to }: { to: string }) => <p>Redirect to {to}</p>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: env.user, loading: false }) }));
vi.mock("@/hooks/use-parent-mode", () => ({
  useParentMode: () => ({ isParentMode: env.parentMode, loading: env.parentLoading }),
}));
vi.mock("@/lib/availability-gate", () => ({
  useAvailabilityGate: () => ({
    canPost: env.canPost,
    reason: env.reason,
    loading: env.gateLoading,
  }),
}));
vi.mock("@/components/layout/BackHeader", () => ({
  BackHeader: ({ title }: { title: string }) => <header>{title}</header>,
}));
vi.mock("@/components/players/MineView", () => ({
  MineView: () => <section aria-label="Your posts, invitations and requests" />,
}));
vi.mock("@/components/availability/AvailabilityRequiredNotice", () => ({
  AvailabilityRequiredNotice: ({
    reason,
    returnTo,
    onSwitched,
  }: {
    reason: string;
    returnTo: string;
    onSwitched?: () => void;
  }) => (
    <div>
      <p>
        Notice: {reason} back to {returnTo}
      </p>
      <button type="button" onClick={() => onSwitched?.()}>
        Stub: switched
      </button>
    </div>
  ),
}));
vi.mock("@/components/availability/QuickAvailabilitySheet", () => ({
  QuickAvailabilitySheet: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="I'm available sheet" /> : null,
}));
vi.mock("@/components/availability/PostAvailabilityDialog", () => ({
  PostAvailabilityDialog: () => <div role="dialog" aria-label="Full availability form" />,
}));

import { Route } from "@/routes/availability";

const options = (
  Route as unknown as {
    options: {
      component: () => ReactNode;
      validateSearch: { parse: (s: Record<string, unknown>) => { compose: string } };
    };
  }
).options;

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Page = options.component;
  return render(
    <QueryClientProvider client={qc}>
      <Page />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  env.search = { compose: "" };
  env.user = { id: "me" };
  env.parentMode = false;
  env.parentLoading = false;
  env.canPost = true;
  env.reason = null;
  env.gateLoading = false;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("/availability", () => {
  it("one screen: posts, invitations and requests, with I'm available on top", () => {
    show();
    expect(screen.getByRole("heading", { name: "My availability & invitations" })).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Your posts, invitations and requests" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /I'm available/ }));
    expect(screen.getByRole("dialog", { name: "I'm available sheet" })).toBeTruthy();
  });

  it("a member who can't post sees why, with the way back to posting", () => {
    env.canPost = false;
    env.reason = "incomplete_profile";
    show();
    expect(
      screen.getByText("Notice: incomplete_profile back to /availability?compose=quick"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /I'm available/ })).toBeNull();
  });

  it("back from Complete my profile: opens the quick sheet once and clears the flag", () => {
    env.search = { compose: "quick" };
    show();
    expect(screen.getByRole("dialog", { name: "I'm available sheet" })).toBeTruthy();
    expect(env.navigate).toHaveBeenCalledWith({ search: { compose: "" }, replace: true });
  });

  it("still can't post: clears the flag and explains, without opening the sheet (no loop)", () => {
    env.search = { compose: "quick" };
    env.canPost = false;
    env.reason = "incomplete_profile";
    show();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(env.navigate).toHaveBeenCalledWith({ search: { compose: "" }, replace: true });
    expect(screen.getByText(/Notice: incomplete_profile/)).toBeTruthy();
  });

  it("waits for the posting check before acting on the flag", () => {
    env.search = { compose: "quick" };
    env.canPost = false;
    env.gateLoading = true;
    show();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(env.navigate).not.toHaveBeenCalled();
  });

  it("compose=more opens the full form", () => {
    env.search = { compose: "more" };
    show();
    expect(screen.getByRole("dialog", { name: "Full availability form" })).toBeTruthy();
  });

  it("parent mode goes back to Home instead", () => {
    env.parentMode = true;
    show();
    expect(screen.getByText("Redirect to /feed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /I'm available/ })).toBeNull();
  });

  it("parent mode with a compose link: redirects only, never clears the flag or opens posting", () => {
    env.parentMode = true;
    env.search = { compose: "quick" };
    show();
    expect(screen.getByText("Redirect to /feed")).toBeTruthy();
    expect(env.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("while parent mode is still being checked, nothing to post shows and the compose flag waits", () => {
    env.parentLoading = true;
    env.search = { compose: "quick" };
    const { rerender } = show();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /I'm available/ })).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Your posts, invitations and requests" }),
    ).toBeNull();
    expect(env.navigate).not.toHaveBeenCalled();

    // It settles as parent mode: straight to /feed, the flag untouched.
    env.parentLoading = false;
    env.parentMode = true;
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <options.component />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Redirect to /feed")).toBeTruthy();
    expect(env.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("switched to the player profile and it can post: the quick sheet opens", () => {
    env.canPost = false;
    env.reason = "wrong_profile";
    show();
    // The switch writes the new active profile before it reports success, so the check already passes.
    env.canPost = true;
    env.reason = null;
    fireEvent.click(screen.getByRole("button", { name: "Stub: switched" }));
    expect(screen.getByRole("dialog", { name: "I'm available sheet" })).toBeTruthy();
  });

  it("switched, but the player profile still needs a level: no sheet, the next step shows instead", () => {
    env.canPost = false;
    env.reason = "wrong_profile";
    show();
    env.reason = "incomplete_profile";
    fireEvent.click(screen.getByRole("button", { name: "Stub: switched" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByText("Notice: incomplete_profile back to /availability?compose=quick"),
    ).toBeTruthy();
  });

  it("only known compose values are kept", () => {
    expect(options.validateSearch.parse({ compose: "quick" })).toEqual({ compose: "quick" });
    expect(options.validateSearch.parse({ compose: "more" })).toEqual({ compose: "more" });
    expect(options.validateSearch.parse({ compose: "https://evil.example" })).toEqual({
      compose: "",
    });
    expect(options.validateSearch.parse({})).toEqual({ compose: "" });
  });

  it("the old Mine tab links redirect here, and the Players page links to it", () => {
    const src = readFileSync("src/routes/_tabs.players.tsx", "utf8");
    expect(src).toContain(
      'if (search.tab === "mine") throw redirect({ to: "/availability", replace: true });',
    );
    expect(src).toContain('to="/availability"');
    expect(src).not.toContain("<MineView");
  });
});

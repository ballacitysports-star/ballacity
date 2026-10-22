// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    search?: unknown;
    className?: string;
  }) => (
    <a href={to} data-search={JSON.stringify(search ?? null)} className={className}>
      {children}
    </a>
  ),
  useLocation: () => ({ href: "/feed?sport=soccer" }),
}));

const auth = { user: null as { id: string } | null, loading: false };
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth }));

const storedSession = vi.fn<() => { expiresAt: number | null } | null>(() => null);
vi.mock("@/lib/authgate-log", () => ({ readStoredSupabaseSession: () => storedSession() }));

import { PreviewGate } from "./PreviewGate";

beforeEach(() => {
  auth.user = null;
  auth.loading = false;
  storedSession.mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderGate() {
  const mounted = vi.fn();
  function RealPage() {
    mounted();
    return <p>the real signed-in page</p>;
  }
  render(
    <PreviewGate tab="feed">
      <RealPage />
    </PreviewGate>,
  );
  return mounted;
}

describe("PreviewGate", () => {
  it("shows a signed-out visitor the preview and never mounts the real page", () => {
    const mounted = renderGate();
    expect(screen.getByTestId("signed-out-preview")).toBeTruthy();
    expect(screen.queryByText("the real signed-in page")).toBeNull();
    // Not rendered even once: its hooks would run its member queries.
    expect(mounted).not.toHaveBeenCalled();
  });

  it("shows a member the real page and no preview", () => {
    auth.user = { id: "u1" };
    const mounted = renderGate();
    expect(screen.getByText("the real signed-in page")).toBeTruthy();
    expect(screen.queryByTestId("signed-out-preview")).toBeNull();
    expect(mounted).toHaveBeenCalled();
  });

  it("shows neither while auth is still loading", () => {
    auth.loading = true;
    const mounted = renderGate();
    expect(screen.queryByTestId("signed-out-preview")).toBeNull();
    expect(mounted).not.toHaveBeenCalled();
  });

  it("gives a saved session a moment to sign in before showing the preview", () => {
    vi.useFakeTimers();
    storedSession.mockReturnValue({ expiresAt: null });
    renderGate();
    expect(screen.queryByTestId("signed-out-preview")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.getByTestId("signed-out-preview")).toBeTruthy();
  });

  it("sends the visitor back to the same page after sign-up", () => {
    renderGate();
    const create = screen.getAllByText("Create account")[0]!.closest("a")!;
    expect(JSON.parse(create.getAttribute("data-search")!)).toEqual({
      next: "/feed?sport=soccer",
      mode: "signup",
    });
  });
});

// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The watcher's "the child's session vanished, put the guardian back" path.
 *
 * The auth store publishes "no user" when its server check of the stored
 * session outlasts its hydration timeout, then the user once the check
 * answers. The watcher used to switch back on that first "no user": on a slow
 * auth server, a full page load inside a child's profile signed the child out
 * and sent the guardian to the Parent Center unasked.
 */

type AuthState = { session: unknown; user: { id: string } | null; loading: boolean };

const h = vi.hoisted(() => ({
  state: { session: null, user: null, loading: true } as AuthState,
  getSession: vi.fn(),
  switchBackToGuardian: vi.fn(),
  parked: true,
}));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => h.state }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: h.getSession } },
}));
vi.mock("@/lib/managed-session", () => ({
  isIdentitySwitchInProgress: () => false,
  readParkedGuardianSession: () => (h.parked ? { childUserId: "child" } : null),
  switchBackToGuardian: h.switchBackToGuardian,
}));

import { useManagedSessionWatcher } from "@/hooks/use-managed-session";

const stored = { data: { session: { user: { id: "child" } } }, error: null };
const gone = { data: { session: null }, error: null };

/** Let the watcher's getSession() answer and its follow-up run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("useManagedSessionWatcher, child session gone", () => {
  beforeEach(() => {
    h.state = { session: null, user: null, loading: true };
    h.parked = true;
    h.getSession.mockReset();
    h.switchBackToGuardian.mockReset();
  });
  afterEach(cleanup);

  it("does not switch back while the stored session is still being verified", async () => {
    h.getSession.mockResolvedValue(stored);
    const { rerender } = renderHook(() => useManagedSessionWatcher());
    // The hydration timeout: loading over, no verified user yet.
    h.state = { session: null, user: null, loading: false };
    rerender();
    await waitFor(() => expect(h.getSession).toHaveBeenCalled());
    await settle();
    expect(h.switchBackToGuardian).not.toHaveBeenCalled();

    // The check answers: the child is still signed in.
    h.state = { session: {}, user: { id: "child" }, loading: false };
    rerender();
    await settle();
    expect(h.switchBackToGuardian).not.toHaveBeenCalled();
  });

  it("switches back when the client holds no session", async () => {
    h.getSession.mockResolvedValue(gone);
    h.state = { session: null, user: null, loading: false };
    renderHook(() => useManagedSessionWatcher());
    await waitFor(() => expect(h.switchBackToGuardian).toHaveBeenCalledTimes(1));
  });

  it("switches back on a sign-out that follows the hydration timeout", async () => {
    h.getSession.mockResolvedValueOnce(stored).mockResolvedValue(gone);
    h.state = { session: null, user: null, loading: false };
    const { rerender } = renderHook(() => useManagedSessionWatcher());
    await settle();
    expect(h.switchBackToGuardian).not.toHaveBeenCalled();

    // SIGNED_OUT (e.g. the child was deleted): same user/loading, new state.
    h.state = { session: null, user: null, loading: false };
    rerender();
    await waitFor(() => expect(h.switchBackToGuardian).toHaveBeenCalledTimes(1));
  });

  it("does nothing on an inconclusive getSession error, or with nothing parked", async () => {
    h.getSession.mockResolvedValue({ data: { session: null }, error: new Error("offline") });
    h.state = { session: null, user: null, loading: false };
    const { rerender } = renderHook(() => useManagedSessionWatcher());
    await waitFor(() => expect(h.getSession).toHaveBeenCalled());
    await settle();
    expect(h.switchBackToGuardian).not.toHaveBeenCalled();

    h.parked = false;
    h.getSession.mockReset().mockResolvedValue(gone);
    h.state = { session: null, user: null, loading: false };
    rerender();
    await settle();
    expect(h.getSession).not.toHaveBeenCalled();
    expect(h.switchBackToGuardian).not.toHaveBeenCalled();
  });
});

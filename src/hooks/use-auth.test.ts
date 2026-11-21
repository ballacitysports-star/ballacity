// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The auth store's start-up: read the stored session, verify it with
 * GET /auth/v1/user, and give up after AUTH_HYDRATION_TIMEOUT_MS (6 s).
 *
 * A slow verification used to publish "signed out" at 6 s, so a member with a
 * valid stored session saw the sign-in preview until /user answered.
 */

type Listener = (event: string, session: unknown) => void;

const h = vi.hoisted(() => ({
  listeners: [] as Listener[],
  getSession: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: Listener) => {
        h.listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      getSession: h.getSession,
      getUser: h.getUser,
      signOut: h.signOut,
    },
  },
}));

const TIMEOUT = 6_000;

function makeSession(id: string, token = `token-${id}`, updatedAt = "2026-11-01T00:00:00Z") {
  return {
    access_token: token,
    user: { id, updated_at: updatedAt, app_metadata: {}, user_metadata: {} },
  };
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function mountUseAuth() {
  const { useAuth } = await import("@/hooks/use-auth");
  return renderHook(() => useAuth());
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function fire(event: string, session: unknown) {
  act(() => {
    for (const l of h.listeners) l(event, session);
  });
}

describe("useAuth hydration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    h.listeners = [];
    h.getSession.mockReset();
    h.getUser.mockReset();
    h.signOut.mockReset().mockResolvedValue({ error: null });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("publishes the stored member, not signed out, when GET /user outlasts the timeout", async () => {
    const stored = makeSession("member");
    h.getSession.mockResolvedValue({ data: { session: stored }, error: null });
    const slowUser = deferred<unknown>();
    h.getUser.mockReturnValue(slowUser.promise);

    const { result } = await mountUseAuth();
    await advance(TIMEOUT - 1);
    expect(result.current.loading).toBe(true);

    await advance(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.user?.id).toBe("member");
    expect(result.current.session).toBe(stored);

    // The check answers later with the verified user, which replaces it.
    const verified = { ...stored.user, email: "m@example.test" };
    await act(async () => {
      slowUser.resolve({ data: { user: verified }, error: null });
    });
    expect(result.current.user).toBe(verified);
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("still signs out when the slow check finally says the user is gone", async () => {
    h.getSession.mockResolvedValue({ data: { session: makeSession("deleted") }, error: null });
    const slowUser = deferred<unknown>();
    h.getUser.mockReturnValue(slowUser.promise);

    const { result } = await mountUseAuth();
    await advance(TIMEOUT);
    expect(result.current.user?.id).toBe("deleted");

    await act(async () => {
      slowUser.resolve({ data: { user: null }, error: { message: "User not found" } });
    });
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("signs out at once on an invalid-user answer within the timeout", async () => {
    h.getSession.mockResolvedValue({ data: { session: makeSession("deleted") }, error: null });
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid JWT" } });

    const { result } = await mountUseAuth();
    await advance(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.user).toBeNull();
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("publishes signed out when there is no stored session", async () => {
    h.getSession.mockResolvedValue({ data: { session: null }, error: null });

    const { result } = await mountUseAuth();
    await advance(0);
    expect(result.current).toMatchObject({ session: null, user: null, loading: false });
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("keeps the stored session when GET /user fails on the network", async () => {
    const stored = makeSession("member");
    h.getSession.mockResolvedValue({ data: { session: stored }, error: null });
    h.getUser.mockRejectedValue(new TypeError("Failed to fetch"));

    const { result } = await mountUseAuth();
    await advance(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.user?.id).toBe("member");
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("keeps the stored session when GET /user answers with a non-auth error", async () => {
    const stored = makeSession("member");
    h.getSession.mockResolvedValue({ data: { session: stored }, error: null });
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: "fetch failed" } });

    const { result } = await mountUseAuth();
    await advance(0);
    expect(result.current.user?.id).toBe("member");
    expect(h.signOut).not.toHaveBeenCalled();
  });

  /** The stored member published by the timeout while GET /user is still in flight. */
  async function publishedUnverified() {
    const stored = makeSession("member");
    h.getSession.mockResolvedValue({ data: { session: stored }, error: null });
    const slowUser = deferred<unknown>();
    h.getUser.mockReturnValue(slowUser.promise);
    const hook = await mountUseAuth();
    await advance(TIMEOUT);
    expect(hook.result.current.user?.id).toBe("member");
    return { ...hook, stored, slowUser };
  }

  it("stays signed out when a late GET /user answers after SIGNED_OUT", async () => {
    const { result, stored, slowUser } = await publishedUnverified();
    fire("SIGNED_OUT", null);
    await act(async () => {
      slowUser.resolve({ data: { user: stored.user }, error: null });
    });
    expect(result.current).toMatchObject({ session: null, user: null, loading: false });
  });

  it("stays signed out when a late GET /user fails after SIGNED_OUT", async () => {
    const { result, slowUser } = await publishedUnverified();
    fire("SIGNED_OUT", null);
    await act(async () => {
      slowUser.reject(new TypeError("Failed to fetch"));
    });
    expect(result.current).toMatchObject({ session: null, user: null, loading: false });
  });

  it("does not sign out another account on a late 'user not found' for the first", async () => {
    const { result, slowUser } = await publishedUnverified();
    const other = makeSession("other");
    fire("SIGNED_IN", other);
    await act(async () => {
      slowUser.resolve({ data: { user: null }, error: { message: "User not found" } });
    });
    expect(result.current.session).toBe(other);
    expect(result.current.user).toBe(other.user);
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("keeps a refreshed token when a late GET /user succeeds", async () => {
    const { result, stored, slowUser } = await publishedUnverified();
    const refreshed = makeSession("member", "token-2");
    fire("TOKEN_REFRESHED", refreshed);
    const verified = { ...stored.user, email: "m@example.test" };
    await act(async () => {
      slowUser.resolve({ data: { user: verified }, error: null });
    });
    expect(result.current.session).toBe(refreshed);
    expect(result.current.user).toBe(verified);
  });

  it("keeps a refreshed token when a late GET /user fails", async () => {
    const { result, slowUser } = await publishedUnverified();
    const refreshed = makeSession("member", "token-2");
    fire("TOKEN_REFRESHED", refreshed);
    const before = result.current;
    await act(async () => {
      slowUser.reject(new TypeError("Failed to fetch"));
    });
    expect(result.current).toBe(before);
    expect(result.current.session?.access_token).toBe("token-2");
  });

  it("keeps a refreshed token when a late GET /user answers with a non-auth error", async () => {
    const { result, slowUser } = await publishedUnverified();
    const refreshed = makeSession("member", "token-2");
    fire("TOKEN_REFRESHED", refreshed);
    const before = result.current;
    await act(async () => {
      slowUser.resolve({ data: { user: null }, error: { message: "fetch failed" } });
    });
    expect(result.current).toBe(before);
  });

  it("publishes signed out at the timeout when reading the stored session hangs", async () => {
    h.getSession.mockReturnValue(new Promise(() => undefined));

    const { result } = await mountUseAuth();
    await advance(TIMEOUT - 1);
    expect(result.current.loading).toBe(true);
    await advance(1);
    expect(result.current).toMatchObject({ session: null, user: null, loading: false });
  });
});

describe("useAuth on repeated auth events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    h.listeners = [];
    h.getSession.mockReset();
    h.getUser.mockReset();
    h.signOut.mockReset().mockResolvedValue({ error: null });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function signedIn() {
    const stored = makeSession("member");
    h.getSession.mockResolvedValue({ data: { session: stored }, error: null });
    h.getUser.mockResolvedValue({ data: { user: stored.user }, error: null });
    const hook = await mountUseAuth();
    await advance(0);
    expect(hook.result.current.user?.id).toBe("member");
    return { ...hook, stored };
  }

  it("keeps the same state for a re-emitted SIGNED_IN of the same member", async () => {
    const { result, stored } = await signedIn();
    const before = result.current;
    // What supabase-js sends when another tab opens or this one becomes visible.
    fire("SIGNED_IN", makeSession("member", stored.access_token));
    fire("SIGNED_IN", makeSession("member", stored.access_token));
    expect(result.current).toBe(before);
  });

  it("updates only the session, keeping the user object, on a new token", async () => {
    const { result } = await signedIn();
    const user = result.current.user;
    const refreshed = makeSession("member", "token-2");
    fire("TOKEN_REFRESHED", refreshed);
    expect(result.current.session).toBe(refreshed);
    expect(result.current.user).toBe(user);
  });

  it("replaces the user when the session carries a newer user record", async () => {
    const { result } = await signedIn();
    const newer = makeSession("member", "token-2", "2026-11-05T00:00:00Z");
    fire("TOKEN_REFRESHED", newer);
    expect(result.current.user).toBe(newer.user);
  });

  it("replaces the user on USER_UPDATED and on a different member", async () => {
    const { result, stored } = await signedIn();
    const updated = makeSession("member", stored.access_token);
    fire("USER_UPDATED", updated);
    expect(result.current.user).toBe(updated.user);

    const other = makeSession("other");
    fire("SIGNED_IN", other);
    expect(result.current.user).toBe(other.user);
  });

  it("signs out on SIGNED_OUT", async () => {
    const { result } = await signedIn();
    fire("SIGNED_OUT", null);
    expect(result.current).toMatchObject({ session: null, user: null, loading: false });
  });
});

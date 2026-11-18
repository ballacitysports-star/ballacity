import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getCurrentUserId reads the id from the locally held session (supabase.auth.getSession), never
 * from the auth server's /user endpoint, and answers null whenever there is no usable session.
 */

const getSession = vi.fn();
const getUser = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => getSession(), getUser: () => getUser() } },
}));

const { getCurrentUserId } = await import("./current-user-id");

const session = (id: string) => ({ user: { id }, access_token: "token", expires_at: 0 });

describe("getCurrentUserId", () => {
  beforeEach(() => {
    getSession.mockReset();
    getUser.mockReset();
  });

  it("returns the id of the stored session without asking the auth server", async () => {
    getSession.mockResolvedValue({ data: { session: session("user-1") }, error: null });
    await expect(getCurrentUserId()).resolves.toBe("user-1");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("returns null when nobody is signed in", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(getCurrentUserId()).resolves.toBeNull();
  });

  it("waits for an expired session's refresh and returns the refreshed session's id", async () => {
    // getSession() refreshes an expiring token before it answers; the id comes from what the
    // refresh returned, so nothing is read from the expired copy.
    let finishRefresh!: () => void;
    getSession.mockReturnValue(
      new Promise((resolve) => {
        finishRefresh = () => resolve({ data: { session: session("user-2") }, error: null });
      }),
    );
    let settled = false;
    const pending = getCurrentUserId().then((id) => {
      settled = true;
      return id;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finishRefresh();
    await expect(pending).resolves.toBe("user-2");
  });

  it("returns null when the refresh of an expired session is refused", async () => {
    getSession.mockResolvedValue({
      data: { session: null },
      error: { name: "AuthApiError", message: "Invalid Refresh Token" },
    });
    await expect(getCurrentUserId()).resolves.toBeNull();
  });

  it("returns null when reading the session throws", async () => {
    getSession.mockRejectedValue(new Error("storage unavailable"));
    await expect(getCurrentUserId()).resolves.toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const getUser = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getUser: () => getUser() } },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));

import { cancelFollowRequest, followUser, removeFollower, respondToFollowRequest } from "./follows";

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "me" } } });
});

describe("followUser", () => {
  it("follows through request_follow, never a direct insert, and reports what happened", async () => {
    rpc.mockResolvedValueOnce({ data: "following", error: null });
    expect(await followUser("them")).toBe("following");
    expect(rpc).toHaveBeenCalledWith("request_follow", { _target: "them" });

    rpc.mockResolvedValueOnce({ data: "requested", error: null });
    expect(await followUser("private")).toBe("requested");
  });

  it("needs a signed-in user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(followUser("them")).rejects.toThrow("Sign in to follow");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("explains a refusal in plain words", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "FOLLOW_LOCKED" } });
    await expect(followUser("them")).rejects.toThrow(/parent or guardian/);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "INVALID_FOLLOW_TARGET" } });
    await expect(followUser("them")).rejects.toThrow(/isn't available/);
  });
});

describe("answering and managing", () => {
  it("passes the right arguments to the database functions", async () => {
    rpc.mockResolvedValue({ data: "approved", error: null });
    await respondToFollowRequest("req", "target", true);
    expect(rpc).toHaveBeenLastCalledWith("respond_follow_request", {
      _requester: "req",
      _target: "target",
      _approve: true,
    });
    await respondToFollowRequest("req", "target", false);
    expect(rpc).toHaveBeenLastCalledWith("respond_follow_request", {
      _requester: "req",
      _target: "target",
      _approve: false,
    });
    await removeFollower("target", "fan");
    expect(rpc).toHaveBeenLastCalledWith("remove_follower", {
      _target: "target",
      _follower: "fan",
    });
    await cancelFollowRequest("target");
    expect(rpc).toHaveBeenLastCalledWith("cancel_follow_request", { _target: "target" });
  });

  it("surfaces the database's refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "FOLLOW_NOT_ALLOWED" } });
    await expect(respondToFollowRequest("req", "target", true)).rejects.toThrow(
      /can't change this account's followers/,
    );
    rpc.mockResolvedValue({ data: null, error: { message: "NO_SUCH_FOLLOW_REQUEST" } });
    await expect(removeFollower("target", "fan")).rejects.toThrow(/no longer there/);
  });
});

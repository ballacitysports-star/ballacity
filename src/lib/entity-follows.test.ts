import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import {
  entityFollowErrorMessage,
  followEntity,
  getEntityFollowCounts,
  getEntityFollowState,
  unfollowEntity,
} from "./entity-follows";

// A block body: vitest runs a function returned from beforeEach as teardown.
beforeEach(() => {
  rpc.mockReset();
});

describe("entityFollowErrorMessage", () => {
  it("explains a consent lock", () => {
    expect(entityFollowErrorMessage("FOLLOW_LOCKED")).toMatch(/parent or guardian/);
  });

  it("does not reveal a block: blocked and unavailable read the same", () => {
    expect(entityFollowErrorMessage("FOLLOW_BLOCKED")).toBe(
      entityFollowErrorMessage("INVALID_FOLLOW_TARGET"),
    );
    expect(entityFollowErrorMessage("FOLLOW_BLOCKED")).not.toMatch(/block/i);
  });

  it("passes unknown errors through", () => {
    expect(entityFollowErrorMessage("network down")).toBe("network down");
  });
});

describe("entity follow calls", () => {
  it("follows and unfollows through the RPCs, never a table write", async () => {
    rpc.mockResolvedValue({ data: "following", error: null });
    await followEntity("team", "c-lakeside-ab12");
    expect(rpc).toHaveBeenCalledWith("follow_entity", { _kind: "team", _id: "c-lakeside-ab12" });
    rpc.mockResolvedValue({ data: null, error: null });
    await unfollowEntity("org", "0b6f7c1e-0000-4000-8000-000000000000");
    expect(rpc).toHaveBeenCalledWith("unfollow_entity", {
      _kind: "org",
      _id: "0b6f7c1e-0000-4000-8000-000000000000",
    });
  });

  it("maps a refusal to member-facing words", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "FOLLOW_BLOCKED" } });
    await expect(followEntity("team", "x")).rejects.toThrow("This page can't be followed.");
  });

  it("reads the state row, and an empty result as not following", async () => {
    rpc.mockResolvedValue({ data: [{ following: true, followers: 7 }], error: null });
    expect(await getEntityFollowState("team", "x")).toEqual({ following: true, followers: 7 });
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await getEntityFollowState("team", "hidden")).toEqual({
      following: false,
      followers: 0,
    });
  });
});

describe("entity follow counts for a list (P1-1)", () => {
  it("asks once for the whole list and maps the rows by id", async () => {
    rpc.mockResolvedValue({
      data: [
        { id: "a", followers: 3, following: true },
        { id: "b", followers: 0, following: false },
      ],
      error: null,
    });
    const counts = await getEntityFollowCounts("team", ["a", "b", "hidden"]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("entity_follow_counts", {
      _kind: "team",
      _ids: ["a", "b", "hidden"],
    });
    expect(counts.get("a")).toEqual({ followers: 3, following: true });
    expect(counts.get("b")).toEqual({ followers: 0, following: false });
    expect(counts.has("hidden")).toBe(false);
  });

  it("asks in calls of at most 200 ids (the database's cap) and counts every id", async () => {
    rpc.mockImplementation((_fn: string, args: { _ids: string[] }) =>
      Promise.resolve({
        data: args._ids.map((id) => ({ id, followers: 1, following: false })),
        error: null,
      }),
    );
    const ids = Array.from({ length: 450 }, (_, i) => `t${i}`);
    const counts = await getEntityFollowCounts("team", ids);
    expect(rpc.mock.calls.map((c) => (c[1] as { _ids: string[] })._ids.length)).toEqual([
      200, 200, 50,
    ]);
    expect(counts.size).toBe(450);
    expect(counts.get("t449")).toEqual({ followers: 1, following: false });
  });

  it("makes no call for no ids", async () => {
    expect((await getEntityFollowCounts("team", [])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails as a whole when one batch is refused, so no card shows a wrong number", async () => {
    rpc
      .mockResolvedValueOnce({ data: [{ id: "t0", followers: 2, following: false }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "NOT_SIGNED_IN" } });
    await expect(
      getEntityFollowCounts(
        "team",
        Array.from({ length: 201 }, (_, i) => `t${i}`),
      ),
    ).rejects.toThrow("Sign in to follow");
  });
});

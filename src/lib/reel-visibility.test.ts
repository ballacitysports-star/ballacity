import { describe, expect, it } from "vitest";
import { eligibleFeedReelIds, eligibleUserReelIds } from "@/lib/reel-visibility.server";

/**
 * The public feed and the public player card must never widen the audience gate
 * themselves: the eligible ids come from the SECURITY DEFINER RPCs, which apply
 * `public.reel_visible_to()` in SQL. These tests pin the contract:
 *
 * - The caller's id (or null for a signed-out visitor) is handed to SQL as `_viewer`.
 *   Whether that person may watch a reel, public or followers-only, is decided there.
 * - Nothing is filtered or added in JS, so a reel the gate excluded can never appear.
 */

type Call = { name: string; args: any };

/** A stand-in for the RPCs: each viewer gets the ids the database would give them. */
function fakeAdmin(idsByViewer: Record<string, string[]>) {
  const calls: Call[] = [];
  return {
    calls,
    rpc(name: string, args: any) {
      calls.push({ name, args });
      const ids = idsByViewer[args._viewer ?? "anonymous"] ?? [];
      return Promise.resolve({ data: ids.map((id) => ({ id, created_at: "2026-01-01" })) });
    },
  };
}

describe("audience-gated reel reads", () => {
  const rows = {
    anonymous: ["adult-public"],
    "viewer-1": ["adult-public", "followed-adult-reel"],
  };

  it("asks for a signed-out visitor with no viewer, and gets only what SQL allows them", async () => {
    const admin = fakeAdmin(rows);
    const ids = await eligibleFeedReelIds(admin as any, {
      cursor: null,
      sport: null,
      limit: 8,
      viewerId: null,
    });
    expect(admin.calls[0].name).toBe("public_reel_feed_ids");
    expect(admin.calls[0].args._viewer).toBeNull();
    expect(ids).toEqual(["adult-public"]);
    expect(ids).not.toContain("followed-adult-reel");
  });

  it("passes a signed-in viewer's id, so SQL can include what they follow", async () => {
    const admin = fakeAdmin(rows);
    const ids = await eligibleFeedReelIds(admin as any, {
      cursor: "2026-02-01",
      sport: "Basketball",
      limit: 8,
      viewerId: "viewer-1",
    });
    expect(admin.calls[0].args).toMatchObject({
      _cursor: "2026-02-01",
      _sport: "Basketball",
      _limit: 8,
      _viewer: "viewer-1",
    });
    expect(ids).toEqual(["adult-public", "followed-adult-reel"]);
  });

  it("never sends the old signed-in flag", async () => {
    const admin = fakeAdmin(rows);
    await eligibleFeedReelIds(admin as any, { cursor: null, sport: null, limit: 8, viewerId: "x" });
    await eligibleUserReelIds(admin as any, { userId: "u", limit: 12, viewerId: "x" });
    for (const c of admin.calls) expect(c.args).not.toHaveProperty("_include_members");
  });

  it("never returns reels the gate excluded, even if other rows exist", async () => {
    // A 'none' reel (child / locked account) is simply absent from the RPC
    // result, so no code path can surface it.
    const admin = fakeAdmin({});
    await expect(
      eligibleUserReelIds(admin as any, { userId: "child-user", limit: 12, viewerId: "viewer-1" }),
    ).resolves.toEqual([]);
    expect(admin.calls[0].name).toBe("public_user_reel_ids");
    expect(admin.calls[0].args).toMatchObject({ _user_id: "child-user", _viewer: "viewer-1" });
  });

  it("propagates gate errors instead of falling back to an ungated read", async () => {
    const admin = {
      rpc: () => Promise.resolve({ error: { message: "gate unavailable" } }),
    };
    await expect(
      eligibleFeedReelIds(admin as any, { cursor: null, sport: null, limit: 8, viewerId: null }),
    ).rejects.toThrow(/gate unavailable/);
  });
});

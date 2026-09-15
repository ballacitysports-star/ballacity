import { describe, expect, it } from "vitest";
import { eligibleFeedReelIds, eligibleUserReelIds } from "@/lib/reel-visibility.server";

/**
 * The public feed and the public player card must never widen the audience gate
 * themselves: the eligible ids come from the SECURITY DEFINER RPCs, which apply
 * `public.reel_audience()` in SQL. These tests pin the contract:
 *
 * - 'none' reels (children, 13-15, locked child accounts) are never requested
 *   nor returned, because the gate is not evaluated in JS at all.
 * - 'members' reels (16-17) are only requested when a viewer is signed in.
 */

type Call = { name: string; args: any };

function fakeAdmin(rowsByMode: { public: string[]; members: string[] }) {
  const calls: Call[] = [];
  return {
    calls,
    rpc(name: string, args: any) {
      calls.push({ name, args });
      const ids = args._include_members
        ? [...rowsByMode.public, ...rowsByMode.members]
        : rowsByMode.public;
      return Promise.resolve({ data: ids.map((id) => ({ id, created_at: "2026-01-01" })) });
    },
  };
}

describe("audience-gated reel reads", () => {
  it("asks for public-only reels for an anonymous viewer", async () => {
    const admin = fakeAdmin({ public: ["adult-1"], members: ["teen16-1"] });
    const ids = await eligibleFeedReelIds(admin as any, {
      cursor: null,
      sport: null,
      limit: 8,
      includeMembers: false,
    });
    expect(admin.calls[0].name).toBe("public_reel_feed_ids");
    expect(admin.calls[0].args._include_members).toBe(false);
    expect(ids).toEqual(["adult-1"]);
    expect(ids).not.toContain("teen16-1");
  });

  it("includes members-only reels for a signed-in viewer", async () => {
    const admin = fakeAdmin({ public: ["adult-1"], members: ["teen16-1"] });
    const ids = await eligibleFeedReelIds(admin as any, {
      cursor: "2026-02-01",
      sport: "Basketball",
      limit: 8,
      includeMembers: true,
    });
    expect(admin.calls[0].args).toMatchObject({
      _cursor: "2026-02-01",
      _sport: "Basketball",
      _limit: 8,
      _include_members: true,
    });
    expect(ids).toEqual(["adult-1", "teen16-1"]);
  });

  it("never returns reels the gate excluded, even if other rows exist", async () => {
    // A 'none' reel (child / locked account) is simply absent from the RPC
    // result, so no code path can surface it.
    const admin = fakeAdmin({ public: [], members: [] });
    await expect(
      eligibleUserReelIds(admin as any, { userId: "child-user", limit: 12, includeMembers: true }),
    ).resolves.toEqual([]);
    expect(admin.calls[0].name).toBe("public_user_reel_ids");
  });

  it("propagates gate errors instead of falling back to an ungated read", async () => {
    const admin = {
      rpc: () => Promise.resolve({ error: { message: "gate unavailable" } }),
    };
    await expect(
      eligibleFeedReelIds(admin as any, {
        cursor: null,
        sport: null,
        limit: 8,
        includeMembers: false,
      }),
    ).rejects.toThrow(/gate unavailable/);
  });
});

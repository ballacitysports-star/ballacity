import { describe, expect, it } from "vitest";
import {
  FOLLOWING_SCAN_PAGES,
  followedEligibleReelIds,
  type FollowingScanClient,
} from "./highlight-feed.functions";

type Row = { id: string; user_id: string; created_at: string };

/** A fake admin client: `follows` rows and `highlight_reels` rows, with call logging. */
function fakeAdmin(followees: string[], reels: Row[], calls: string[] = []): FollowingScanClient {
  return {
    from(table: string) {
      const q: Record<string, unknown> & { _ids: string[] | null } = {
        _ids: null as string[] | null,
        select: () => q,
        eq: (col: string, v: unknown) => {
          calls.push(`${table}.eq(${col},${String(v)})`);
          return q;
        },
        limit: () => q,
        in: (_c: string, ids: string[]) => {
          q._ids = ids;
          return q;
        },
        order: () => q,
        then: (ok: (r: unknown) => unknown) => {
          if (table === "follows")
            return Promise.resolve({
              data: followees.map((f) => ({ followee_id: f })),
              error: null,
            }).then(ok);
          const data = reels
            .filter((r) => (q._ids ?? []).includes(r.id))
            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
          return Promise.resolve({ data, error: null }).then(ok);
        },
      };
      return q as unknown as ReturnType<FollowingScanClient["from"]>;
    },
  };
}

/** Eligible ids, newest first, 50 per page after the cursor (what public_reel_feed_ids returns). */
function eligible(
  reels: Row[],
  calls: { cursor: string | null; limit: number; includeMembers: boolean }[] = [],
) {
  return async (
    _admin: unknown,
    a: { cursor: string | null; limit: number; includeMembers: boolean },
  ) => {
    calls.push(a);
    return reels
      .filter((r) => !a.cursor || r.created_at < a.cursor)
      .sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
      .slice(0, a.limit)
      .map((r) => r.id);
  };
}

const reel = (i: number, user: string): Row => ({
  id: `r${i}`,
  user_id: user,
  created_at: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString(),
});

describe("followedEligibleReelIds (P3-2)", () => {
  it("keeps only eligible reels by people the viewer follows, newest first", async () => {
    const reels = [reel(1, "alice"), reel(2, "bob"), reel(3, "alice"), reel(4, "carol")];
    const out = await followedEligibleReelIds(
      fakeAdmin(["alice", "carol"], reels),
      eligible(reels),
      {
        viewerId: "me",
        sport: null,
        want: 6,
      },
    );
    expect(out).toEqual(["r4", "r3", "r1"]);
  });

  it("asks nothing more when the viewer follows nobody", async () => {
    const calls: { cursor: string | null; limit: number; includeMembers: boolean }[] = [];
    const out = await followedEligibleReelIds(
      fakeAdmin([], [reel(1, "a")]),
      eligible([reel(1, "a")], calls),
      {
        viewerId: "me",
        sport: null,
        want: 6,
      },
    );
    expect(out).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("pages back with the cursor, signed-in audience, and stops after the scan limit", async () => {
    // 200 reels by strangers, one followed reel older than the scan window.
    const reels = [reel(0, "alice"), ...Array.from({ length: 200 }, (_, i) => reel(i + 1, "x"))];
    const calls: { cursor: string | null; limit: number; includeMembers: boolean }[] = [];
    const out = await followedEligibleReelIds(fakeAdmin(["alice"], reels), eligible(reels, calls), {
      viewerId: "me",
      sport: null,
      want: 6,
    });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(FOLLOWING_SCAN_PAGES);
    expect(calls.every((c) => c.includeMembers === true && c.limit === 50)).toBe(true);
    expect(calls[0].cursor).toBeNull();
    expect(calls[1].cursor).not.toBeNull();
  });

  it("stops as soon as it has enough", async () => {
    const reels = Array.from({ length: 120 }, (_, i) => reel(i, "alice"));
    const calls: { cursor: string | null; limit: number; includeMembers: boolean }[] = [];
    const out = await followedEligibleReelIds(fakeAdmin(["alice"], reels), eligible(reels, calls), {
      viewerId: "me",
      sport: null,
      want: 3,
    });
    expect(out).toHaveLength(3);
    expect(calls).toHaveLength(1);
  });
});

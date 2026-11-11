import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcResults: Record<string, { data: unknown; error: { message: string } | null }> = {};
const tables: Record<string, unknown[]> = {};
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "eq"]) b[m] = () => b;
    b.then = (ok: (r: unknown) => unknown) =>
      Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok);
    return b;
  };
  return {
    supabase: {
      from: (t: string) => builder(t),
      rpc: (fn: string) => Promise.resolve(rpcResults[fn] ?? { data: [], error: null }),
    },
  };
});

import { listFollowingPosts } from "./network-posts";

beforeEach(() => {
  for (const k of Object.keys(rpcResults)) delete rpcResults[k];
  for (const k of Object.keys(tables)) delete tables[k];
  tables.teams = [{ id: "ff-team", name: "FF Team", avatar_url: null }];
  tables.profiles = [{ id: "u1", display_name: "Sam", avatar_url: null }];
});

const post = (id: string, at: string) => ({
  id,
  author_id: "u1",
  posted_as: "person",
  team_id: null,
  org_id: null,
  audience: "public",
  body: `post ${id}`,
  moderation_status: "approved",
  created_at: at,
});

describe("listFollowingPosts", () => {
  it("merges followed posts and team news, newest first, news under the team's name", async () => {
    rpcResults.following_feed = { data: [post("p1", "2026-11-07T10:00:00Z")], error: null };
    rpcResults.following_team_news = {
      data: [
        {
          id: "n1",
          team_id: "ff-team",
          kind: "announcement",
          title: "Season opener",
          body: "Saturday",
          created_at: "2026-11-07T11:00:00Z",
        },
      ],
      error: null,
    };
    const items = await listFollowingPosts();
    expect(items.map((i) => i.id)).toEqual(["news-n1", "p1"]);
    expect(items[0]).toMatchObject({
      authorName: "FF Team",
      postedAs: "team",
      body: "Season opener\nSaturday",
      authorId: "",
    });
  });

  it("still shows posts when team news fails", async () => {
    rpcResults.following_feed = { data: [post("p1", "2026-11-07T10:00:00Z")], error: null };
    rpcResults.following_team_news = { data: null, error: { message: "boom" } };
    expect((await listFollowingPosts()).map((i) => i.id)).toEqual(["p1"]);
  });

  it("fails when the posts themselves fail", async () => {
    rpcResults.following_feed = { data: null, error: { message: "denied" } };
    await expect(listFollowingPosts()).rejects.toThrow();
  });
});

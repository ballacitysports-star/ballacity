import { beforeEach, describe, expect, it, vi } from "vitest";

// A server function is its handler for these tests: validate the input, then run it.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (d: unknown) => d;
    const b = {
      inputValidator(fn: (d: unknown) => unknown) {
        validate = fn;
        return b;
      },
      handler(fn: (ctx: { data: unknown }) => unknown) {
        return (arg?: { data?: unknown }) => fn({ data: validate(arg?.data) });
      },
    };
    return b;
  },
}));

type Result = { data: unknown; error: { message: string } | null };
const db = {
  reels: [] as Record<string, unknown>[],
  games: { data: [], error: null } as Result,
  gameSelect: "",
  reelSelect: "",
};

const chain = (result: () => Result) => {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "in", "eq", "order"]) c[m] = () => c;
  c.then = (resolve: (r: Result) => unknown) => resolve(result());
  return c;
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const c = chain(() => {
        if (table === "highlight_reels") return { data: db.reels, error: null };
        if (table === "hosted_games") return db.games;
        return { data: [], error: null };
      });
      const select = c.select;
      c.select = (cols: string) => {
        if (table === "hosted_games") db.gameSelect = cols;
        if (table === "highlight_reels") db.reelSelect = cols;
        return (select as () => unknown)();
      };
      return c;
    },
    rpc: async () => ({ data: [], error: null }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
  },
}));

vi.mock("@/lib/reel-visibility.server", () => ({
  optionalSupabaseUserId: async () => null,
  eligibleFeedReelIds: async () => db.reels.map((r) => String(r.id)),
  quarantinedMediaPaths: async () => new Set<string>(),
  signablePath: (p: string | null) => p,
}));

import { listHighlightFeed } from "@/lib/highlight-feed.functions";

// Distinctive values that must never reach a signed-out response for a restricted game.
const SECRET = {
  id: "game-secret-9",
  title: "Zeppelin Heights Run",
  sport: "Lacrosse",
  date: "2026-10-12T19:45:00Z",
  location: "Quillon Secret Gym 42",
  stored: "Zeppelin Heights Run (stored on the reel)",
};
const LEAKS = [
  "game-secret-9",
  "Zeppelin",
  "Lacrosse",
  "2026-10-12",
  "Quillon",
  "stored on the reel",
];

const reel = (over: Record<string, unknown> = {}) => ({
  id: "reel-1",
  user_id: "user-1",
  title: "Great night",
  ai_title: null,
  ai_caption: null,
  ai_hashtags: [],
  ai_sport: null,
  video_path: null,
  playback_path: null,
  thumbnail_path: null,
  created_at: "2026-10-13T10:00:00Z",
  game_id: SECRET.id,
  game_title: SECRET.stored,
  ...over,
});

const game = (over: Record<string, unknown> = {}) => ({
  id: SECRET.id,
  title: SECRET.title,
  sport: SECRET.sport,
  date: SECRET.date,
  location: SECRET.location,
  is_private: false,
  hidden_at: null,
  org_hidden_at: null,
  cancelled_at: null,
  min_age: 21,
  max_age: 40,
  ...over,
});

type FeedItem = { id: string; sport: string | null; game: Record<string, unknown> | null };
const feed = async () =>
  (await listHighlightFeed({ data: {} })) as unknown as { items: FeedItem[] };

beforeEach(() => {
  db.reels = [reel()];
  db.games = { data: [game()], error: null };
  db.gameSelect = "";
});

describe("highlight feed linked game", () => {
  it("shows an eligible adult-only game's details, even after it was played", async () => {
    db.games = { data: [game({ date: "2026-01-01T10:00:00Z" })], error: null };
    const { items } = await feed();
    expect(items).toHaveLength(1);
    expect(items[0].game).toEqual({
      id: SECRET.id,
      title: SECRET.title,
      sport: SECRET.sport,
      date: "2026-01-01T10:00:00Z",
      location: SECRET.location,
    });
    expect(items[0].sport).toBe(SECRET.sport);
  });

  it.each([
    ["open-ended 18+", { min_age: 18, max_age: null }],
    ["open-ended 21+", { min_age: 21, max_age: null }],
  ])("shows an eligible %s game", async (_n, over) => {
    db.games = { data: [game(over)], error: null };
    expect((await feed()).items[0].game?.title).toBe(SECRET.title);
  });

  it.each([
    ["youth (maximum 17)", { min_age: null, max_age: 17 }],
    ["youth (8 to 12)", { min_age: 8, max_age: 12 }],
    ["mixed-age (16 to 30)", { min_age: 16, max_age: 30 }],
    ["minimum 13", { min_age: 13, max_age: null }],
    ["unknown age", { min_age: null, max_age: null }],
    ["no minimum, maximum only", { min_age: null, max_age: 40 }],
    ["inverted range", { min_age: 40, max_age: 30 }],
    ["private", { is_private: true }],
    ["hidden", { hidden_at: "2026-10-01T00:00:00Z" }],
    ["cancelled", { cancelled_at: "2026-10-01T00:00:00Z" }],
    ["organization-hidden", { org_hidden_at: "2026-10-01T00:00:00Z" }],
    ["missing eligibility data", { is_private: null }],
  ])("%s: the reel stays but no game detail or stored title is returned", async (_n, over) => {
    db.games = { data: [game(over)], error: null };
    const { items } = await feed();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("reel-1");
    expect(items[0].game).toBeNull();
    const body = JSON.stringify(items);
    for (const leak of LEAKS) expect(body).not.toContain(leak);
  });

  it("a missing or deleted game with a stored title returns no game and not the stored title", async () => {
    db.games = { data: [], error: null };
    const { items } = await feed();
    expect(items).toHaveLength(1);
    expect(items[0].game).toBeNull();
    const body = JSON.stringify(items);
    for (const leak of LEAKS) expect(body).not.toContain(leak);
  });

  it("a game lookup error fails closed: no game detail, no stored title, no game id", async () => {
    db.games = { data: [game()], error: { message: "boom" } };
    const { items } = await feed();
    expect(items).toHaveLength(1);
    expect(items[0].game).toBeNull();
    const body = JSON.stringify(items);
    for (const leak of LEAKS) expect(body).not.toContain(leak);
  });

  it("a restricted game's sport does not become the reel's sport; the reel's own ai_sport stays", async () => {
    db.games = { data: [game({ is_private: true })], error: null };
    expect((await feed()).items[0].sport).toBeNull();
    db.reels = [reel({ ai_sport: "Basketball" })];
    expect((await feed()).items[0].sport).toBe("Basketball");
  });

  it("a reel without a linked game is unchanged", async () => {
    db.reels = [reel({ game_id: null, game_title: null, ai_sport: "Soccer" })];
    db.games = { data: [], error: null };
    const { items } = await feed();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "reel-1", game: null, sport: "Soccer" });
  });

  it("never selects the stored game_title, and asks for the columns the rule needs", async () => {
    await feed();
    expect(db.reelSelect).not.toContain("game_title");
    for (const col of [
      "is_private",
      "hidden_at",
      "org_hidden_at",
      "cancelled_at",
      "min_age",
      "max_age",
    ]) {
      expect(db.gameSelect).toContain(col);
    }
  });

  it("a mixed page keeps eligible games and drops only the restricted ones", async () => {
    db.reels = [reel({ id: "r-ok", game_id: "g-ok" }), reel({ id: "r-youth", game_id: SECRET.id })];
    db.games = {
      data: [game({ id: "g-ok", title: "Open adult run" }), game({ min_age: 10, max_age: 14 })],
      error: null,
    };
    const { items } = await feed();
    expect(items.find((i) => i.id === "r-ok")?.game?.title).toBe("Open adult run");
    expect(items.find((i) => i.id === "r-youth")?.game).toBeNull();
    // Only the restricted reel's own item is checked: the eligible game shares the fixture values.
    const restricted = JSON.stringify(items.find((i) => i.id === "r-youth"));
    for (const leak of LEAKS) expect(restricted).not.toContain(leak);
  });
});

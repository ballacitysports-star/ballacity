import { beforeEach, describe, expect, it, vi } from "vitest";

// A server function is its handler for these tests: validate the input, then run it.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (d: unknown) => d;
    const b = {
      middleware() {
        return b;
      },
      inputValidator(fn: (d: unknown) => unknown) {
        validate = fn;
        return b;
      },
      handler(fn: (ctx: { data: unknown; context?: unknown }) => unknown) {
        return (arg?: { data?: unknown }) => fn({ data: validate(arg?.data) });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

type Result = { data: unknown; error: { message: string } | null; count?: number };
type Call = { table: string; eq: Record<string, unknown> };

const db = {
  games: { data: [], error: null } as Result,
  hostedGames: [] as Record<string, unknown>[],
  joinedGames: [] as Record<string, unknown>[],
  gamesError: null as { message: string } | null,
  reels: [] as Record<string, unknown>[],
  gameSelect: "",
};

const chain = (call: Call, result: (c: Call) => Result) => {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "in", "order", "limit", "is", "ilike", "neq", "gte", "lte"]) {
    c[m] = () => c;
  }
  c.eq = (k: string, v: unknown) => {
    call.eq[k] = v;
    return c;
  };
  c.maybeSingle = async () => {
    const r = result(call);
    return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
  };
  c.then = (resolve: (r: Result) => unknown) => resolve(result(call));
  return c;
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const call: Call = { table, eq: {} };
      const c = chain(call, (cl) => {
        if (cl.table === "hosted_games") {
          if (db.gamesError) return { data: null, error: db.gamesError };
          if ("host_id" in cl.eq) return { data: db.hostedGames, error: null };
          return { data: db.joinedGames, error: null };
        }
        if (cl.table === "game_participants") {
          return { data: db.joinedGames.map((g) => ({ game_id: g.id })), error: null };
        }
        if (cl.table === "profiles") {
          return { data: [{ id: "u1", display_name: "Pat", suspended_at: null }], error: null };
        }
        if (cl.table === "highlight_reels") return { data: db.reels, error: null, count: 0 };
        if (cl.table === "image_moderation") return { data: [], error: null };
        return { data: [], error: null };
      });
      const select = c.select as (cols: string) => unknown;
      c.select = (cols: string) => {
        if (table === "hosted_games") db.gameSelect = cols;
        return select(cols);
      };
      return c;
    },
    rpc: async (name: string) => {
      if (name === "profile_visibility_of") return { data: "public", error: null };
      if (name === "age_cohort_of") return { data: "adult", error: null };
      return { data: [], error: null };
    },
    storage: {
      from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed" } }) }),
    },
  },
}));

vi.mock("@/lib/reel-visibility.server", () => ({
  optionalSupabaseUserId: async () => null,
  eligibleUserReelIds: async () => db.reels.map((r) => String(r.id)),
  quarantinedMediaPaths: async () => new Set<string>(),
  signablePath: (p: string | null) => p,
}));

import { getPlayerCard } from "@/lib/player-card.functions";
import { listPublicReels } from "@/lib/reels.functions";
import { signPublicGameCover } from "@/lib/media-urls.functions";

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

const game = (over: Record<string, unknown> = {}) => ({
  id: SECRET.id,
  title: SECRET.title,
  sport: SECRET.sport,
  date: SECRET.date,
  location: SECRET.location,
  host_id: "u1",
  is_private: false,
  hidden_at: null,
  org_hidden_at: null,
  cancelled_at: null,
  min_age: 21,
  max_age: 40,
  image: "game-covers/u1/cover-secret.jpg",
  ...over,
});

const RESTRICTED: [string, Record<string, unknown>][] = [
  ["youth (maximum 17)", { min_age: null, max_age: 17 }],
  ["youth (8 to 12)", { min_age: 8, max_age: 12 }],
  ["mixed-age (16 to 30)", { min_age: 16, max_age: 30 }],
  ["minimum 13", { min_age: 13, max_age: null }],
  ["unknown age", { min_age: null, max_age: null }],
  ["maximum only", { min_age: null, max_age: 40 }],
  ["inverted range", { min_age: 40, max_age: 30 }],
  ["private", { is_private: true }],
  ["cancelled", { cancelled_at: "2026-10-01T00:00:00Z" }],
  ["organization-hidden", { org_hidden_at: "2026-10-01T00:00:00Z" }],
  ["hidden", { hidden_at: "2026-10-01T00:00:00Z" }],
  ["missing eligibility data", { is_private: null }],
];

beforeEach(() => {
  db.hostedGames = [];
  db.joinedGames = [];
  db.gamesError = null;
  db.reels = [];
  db.gameSelect = "";
});

describe("getPlayerCard", () => {
  const card = async () => JSON.stringify(await getPlayerCard({ data: { userId: "u1" } }));
  const cardData = async () =>
    (await getPlayerCard({ data: { userId: "u1" } })) as unknown as {
      games: { id: string; title: string; role: string }[];
      stats: { gamesHosted: number };
    };

  it("lists an eligible adult game the player hosted, and one they joined", async () => {
    db.hostedGames = [game({ id: "h1", title: "Hosted run" })];
    db.joinedGames = [game({ id: "j1", title: "Joined run", host_id: "other" })];
    const { games, stats } = await cardData();
    expect(games.map((g) => [g.id, g.role]).sort()).toEqual([
      ["h1", "host"],
      ["j1", "player"],
    ]);
    expect(stats.gamesHosted).toBe(1);
  });

  it.each(RESTRICTED)("%s: a hosted game is not listed or counted", async (_n, over) => {
    db.hostedGames = [game(over)];
    const body = await card();
    for (const leak of LEAKS) expect(body).not.toContain(leak);
    expect((await cardData()).stats.gamesHosted).toBe(0);
  });

  it.each(RESTRICTED)("%s: a joined game is not listed", async (_n, over) => {
    db.joinedGames = [game({ ...over, host_id: "other" })];
    const body = await card();
    for (const leak of LEAKS) expect(body).not.toContain(leak);
    expect((await cardData()).games).toEqual([]);
  });

  it("a failed game lookup lists nothing", async () => {
    db.hostedGames = [game()];
    db.joinedGames = [game({ id: "j1", host_id: "other" })];
    db.gamesError = { message: "boom" };
    const data = await cardData();
    expect(data.games).toEqual([]);
    for (const leak of LEAKS) expect(await card()).not.toContain(leak);
  });

  it("keeps the profile when every game is restricted, and asks for the eligibility columns", async () => {
    db.hostedGames = [game({ is_private: true })];
    const data = (await getPlayerCard({ data: { userId: "u1" } })) as unknown as {
      profile: { displayName: string } | null;
    };
    expect(data.profile?.displayName).toBe("Pat");
    for (const col of ["org_hidden_at", "cancelled_at", "min_age", "max_age", "is_private"]) {
      expect(db.gameSelect).toContain(col);
    }
  });
});

describe("listPublicReels", () => {
  const reel = (over: Record<string, unknown> = {}) => ({
    id: "reel-1",
    user_id: "u1",
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
  const list = async () =>
    (await listPublicReels({ data: { userId: "u1" } })) as unknown as {
      id: string;
      gameTitle: string | null;
    }[];

  it("shows an eligible adult game's current title, not the stored one", async () => {
    db.reels = [reel()];
    db.hostedGames = [game()];
    db.joinedGames = [game()];
    const items = await list();
    expect(items).toHaveLength(1);
    expect(items[0]!.gameTitle).toBe(SECRET.title);
  });

  it.each(RESTRICTED)("%s: the reel stays but no game title is returned", async (_n, over) => {
    db.reels = [reel()];
    db.joinedGames = [game(over)];
    const items = await list();
    expect(items).toHaveLength(1);
    expect(items[0]!.gameTitle).toBeNull();
    for (const leak of LEAKS) expect(JSON.stringify(items)).not.toContain(leak);
  });

  it("a missing or deleted game with a stored title returns no title", async () => {
    db.reels = [reel()];
    db.joinedGames = [];
    const items = await list();
    expect(items[0]!.gameTitle).toBeNull();
    for (const leak of LEAKS) expect(JSON.stringify(items)).not.toContain(leak);
  });

  it("a game lookup error fails closed", async () => {
    db.reels = [reel()];
    db.gamesError = { message: "boom" };
    const items = await list();
    expect(items).toHaveLength(1);
    expect(items[0]!.gameTitle).toBeNull();
    for (const leak of LEAKS) expect(JSON.stringify(items)).not.toContain(leak);
  });

  it("a reel with no linked game is unchanged", async () => {
    db.reels = [reel({ game_id: null, game_title: null })];
    const items = await list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "reel-1", gameTitle: null });
  });
});

describe("signPublicGameCover", () => {
  const sign = async () =>
    (await signPublicGameCover({
      data: { ref: "storage://game-covers/u1/cover-secret.jpg" },
    })) as { url: string | null };

  it("signs the cover of an eligible adult game", async () => {
    db.joinedGames = [game()];
    expect((await sign()).url).toBe("https://signed");
  });

  it.each(RESTRICTED)("%s: the cover is not signed", async (_n, over) => {
    db.joinedGames = [game(over)];
    expect((await sign()).url).toBeNull();
  });

  it("a missing game and a failed lookup both give null", async () => {
    db.joinedGames = [];
    expect((await sign()).url).toBeNull();
    db.joinedGames = [game()];
    db.gamesError = { message: "boom" };
    expect((await sign()).url).toBeNull();
  });

  it("asks for every column the shared rule needs", async () => {
    db.joinedGames = [game()];
    await sign();
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
});

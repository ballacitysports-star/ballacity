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
      handler(fn: (ctx: { data: unknown }) => unknown) {
        return (arg?: { data?: unknown }) => fn({ data: validate(arg?.data) });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

type Result = { data: unknown; error: { message: string } | null };
const db = {
  viewer: null as string | null,
  reels: [] as Record<string, unknown>[],
  games: [] as Record<string, unknown>[],
  gamesError: null as { message: string } | null,
  participantGameIds: [] as string[],
};

const chain = (result: () => Result) => {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "in", "eq", "order", "limit", "is", "ilike"]) c[m] = () => c;
  c.maybeSingle = async () => {
    const r = result();
    return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
  };
  c.then = (resolve: (r: Result) => unknown) => resolve(result());
  return c;
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) =>
      chain(() => {
        if (table === "highlight_reels") return { data: db.reels, error: null };
        if (table === "hosted_games") {
          return db.gamesError
            ? { data: null, error: db.gamesError }
            : { data: db.games, error: null };
        }
        if (table === "game_participants") {
          return { data: db.participantGameIds.map((game_id) => ({ game_id })), error: null };
        }
        return { data: [], error: null };
      }),
    rpc: async (name: string) =>
      name === "reel_audience" ? { data: "public", error: null } : { data: [], error: null },
    storage: {
      from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed" } }) }),
    },
  },
}));

vi.mock("@/lib/reel-visibility.server", () => ({
  optionalSupabaseUserId: async () => db.viewer,
  eligibleFeedReelIds: async () => db.reels.map((r) => String(r.id)),
  eligibleUserReelIds: async () => db.reels.map((r) => String(r.id)),
  quarantinedMediaPaths: async () => new Set<string>(),
  signablePath: (p: string | null) => p,
}));

import { listHighlightFeed } from "@/lib/highlight-feed.functions";
import { listPublicReels } from "@/lib/reels.functions";
import { getPublicReel } from "@/lib/public-reel.functions";
import { Route as ReelRoute } from "@/routes/reels.$reelId";

const SECRET = {
  gameId: "game-secret-9",
  title: "Zeppelin Heights Run Recap",
  caption: "Great night at the Quillon Secret Gym 42 for the Zeppelin run",
  tag: "ZeppelinHeights",
  sport: "Lacrosse",
};
const LEAKS = ["game-secret-9", "Zeppelin", "Quillon", "ZeppelinHeights"];

const reel = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "u1",
  title: SECRET.title,
  ai_title: null,
  ai_caption: SECRET.caption,
  ai_hashtags: [SECRET.tag, "hoops"],
  ai_sport: null,
  video_path: "u1/video.mp4",
  playback_path: null,
  thumbnail_path: null,
  created_at: "2026-10-13T10:00:00Z",
  game_id: SECRET.gameId,
  game_title: "stored Zeppelin title",
  subject_child_id: null,
  ...over,
});

const game = (over: Record<string, unknown> = {}) => ({
  id: SECRET.gameId,
  title: "Open adult run",
  sport: SECRET.sport,
  date: "2026-10-12T19:45:00Z",
  location: "Public Park",
  host_id: "host-1",
  is_private: false,
  hidden_at: null,
  org_hidden_at: null,
  cancelled_at: null,
  min_age: 21,
  max_age: 40,
  ...over,
});

const RESTRICTED: [string, Record<string, unknown>][] = [
  ["youth (maximum 17)", { min_age: null, max_age: 17 }],
  ["mixed-age (16 to 30)", { min_age: 16, max_age: 30 }],
  ["minimum 13", { min_age: 13, max_age: null }],
  ["unknown age", { min_age: null, max_age: null }],
  ["maximum only", { min_age: null, max_age: 40 }],
  ["inverted range", { min_age: 40, max_age: 30 }],
  ["private", { is_private: true }],
  ["hidden", { hidden_at: "2026-10-01T00:00:00Z" }],
  ["cancelled", { cancelled_at: "2026-10-01T00:00:00Z" }],
  ["organization-hidden", { org_hidden_at: "2026-10-01T00:00:00Z" }],
  ["missing eligibility data", { is_private: null }],
];

type Text = { title: string; caption: string | null; hashtags: string[] };
/** The same reel as each of the three public readers returns it. */
const readers: [string, () => Promise<Text>][] = [
  [
    "highlight feed",
    async () => {
      const r = (await listHighlightFeed({ data: {} })) as unknown as { items: Text[] };
      return r.items[0]!;
    },
  ],
  [
    "public reels list",
    async () => {
      const r = (await listPublicReels({ data: { userId: "u1" } })) as unknown as Text[];
      return r[0]!;
    },
  ],
  [
    "shared reel page",
    async () => {
      const r = (await getPublicReel({ data: { id: reel().id } })) as unknown as Text & {
        found: boolean;
      };
      expect(r.found).toBe(true);
      return r;
    },
  ],
];

beforeEach(() => {
  db.viewer = null;
  db.reels = [reel()];
  db.games = [game()];
  db.gamesError = null;
  db.participantGameIds = [];
});

describe.each(readers)("%s", (_name, read) => {
  it("keeps the host-written text of a reel linked to a public adult game", async () => {
    const t = await read();
    expect(t.title).toBe(SECRET.title);
    expect(t.caption).toBe(SECRET.caption);
    expect(t.hashtags).toEqual([SECRET.tag, "hoops"]);
  });

  it.each(RESTRICTED)("%s: title, caption and hashtags are suppressed", async (_n, over) => {
    db.games = [game(over)];
    const t = await read();
    expect(t.title).toBe("Highlight");
    expect(t.caption).toBeNull();
    expect(t.hashtags).toEqual([]);
    for (const leak of LEAKS) expect(JSON.stringify(t)).not.toContain(leak);
  });

  it("a missing game and a failed lookup both fail closed", async () => {
    db.games = [];
    expect((await read()).title).toBe("Highlight");
    db.games = [game()];
    db.gamesError = { message: "boom" };
    const t = await read();
    expect(t.title).toBe("Highlight");
    expect(t.caption).toBeNull();
    for (const leak of LEAKS) expect(JSON.stringify(t)).not.toContain(leak);
  });

  it("a reel with no linked game is unchanged", async () => {
    db.reels = [reel({ game_id: null })];
    db.games = [];
    const t = await read();
    expect(t.title).toBe(SECRET.title);
    expect(t.hashtags).toEqual([SECRET.tag, "hoops"]);
  });

  it("the reel's owner, and the game's host and players, still see the original text", async () => {
    db.games = [game({ is_private: true })];
    db.viewer = "u1";
    expect((await read()).title).toBe(SECRET.title);
    db.viewer = "host-1";
    expect((await read()).caption).toBe(SECRET.caption);
    db.viewer = "player-9";
    db.participantGameIds = [SECRET.gameId];
    expect((await read()).hashtags).toEqual([SECRET.tag, "hoops"]);
  });

  it("another signed-in viewer sees the generic text", async () => {
    db.games = [game({ is_private: true })];
    db.viewer = "stranger";
    const t = await read();
    expect(t.title).toBe("Highlight");
    for (const leak of LEAKS) expect(JSON.stringify(t)).not.toContain(leak);
  });
});

describe("the viewer comes from the server, not the request", () => {
  it("ignores a viewer or owner id supplied by the caller", async () => {
    db.games = [game({ is_private: true })];
    const r = (await listHighlightFeed({
      data: { viewerId: "u1", userId: "u1", isOwner: true } as never,
    })) as unknown as { items: Text[] };
    expect(r.items[0]!.title).toBe("Highlight");
    const one = (await getPublicReel({
      data: { id: reel().id, viewerId: "u1", authorized: true } as never,
    })) as unknown as Text;
    expect(one.title).toBe("Highlight");
  });
});

describe("shared reel page metadata", () => {
  const head = async (over: Record<string, unknown>) => {
    db.games = [game(over)];
    const found = await getPublicReel({ data: { id: reel().id } });
    const route = ReelRoute as unknown as {
      options: { head: (a: { loaderData: unknown; params: { reelId: string } }) => unknown };
    };
    return route.options.head({ loaderData: { reel: found }, params: { reelId: reel().id } });
  };

  it.each(RESTRICTED)(
    "%s: title, description, tags and share card are generic",
    async (_n, over) => {
      const body = JSON.stringify(await head(over));
      for (const leak of LEAKS) expect(body).not.toContain(leak);
      const meta = (await head(over)) as { meta: Record<string, string>[] };
      expect(meta.meta).toContainEqual({ title: "Highlight — BallaCity" });
    },
  );

  it("an eligible reel keeps its title and description in the head", async () => {
    const body = JSON.stringify(await head({}));
    expect(body).toContain(SECRET.title);
    expect(body).toContain("Quillon Secret Gym 42");
  });
});

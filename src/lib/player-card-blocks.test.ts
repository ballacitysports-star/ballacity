import { beforeEach, describe, expect, it, vi } from "vitest";

// The player card reads with the service role, so blocks are checked in the app for the signed-in viewer
// (docs/privacy/profile-blocks-and-suspension.md). These pin that check and the two helpers it uses.

const OWNER = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  authorization: null as string | null,
  noRequest: false,
  claims: {} as Record<string, string>, // token -> sub
  blocked: false,
  blockedError: false,
  staff: false,
  rpcCalls: [] as string[],
  queried: [] as string[],
}));

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

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (h.noRequest) throw new Error("no request context");
    return { headers: new Headers(h.authorization ? { authorization: h.authorization } : {}) };
  },
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const rows: Record<string, unknown[]> = {
    profiles: [
      {
        id: OWNER,
        display_name: "Alex",
        username: "alex",
        avatar_initials: "AL",
        bio: "Point guard",
        city: "Austin",
        suspended_at: null,
        moderation_state: null,
      },
    ],
  };
  const query = (table: string) => {
    h.queried.push(table);
    const data = rows[table] ?? [];
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      is: () => q,
      in: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: data[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data, error: null, count: data.length }).then(ok, ko),
    };
    return q;
  };
  return {
    supabaseAdmin: {
      from: query,
      auth: {
        getClaims: async (token: string) =>
          h.claims[token]
            ? { data: { claims: { sub: h.claims[token] } }, error: null }
            : { data: null, error: { message: "invalid JWT" } },
      },
      rpc: async (name: string) => {
        h.rpcCalls.push(name);
        if (name === "profile_visibility_of") return { data: "public", error: null };
        if (name === "blocks_exist_between")
          return h.blockedError
            ? { data: null, error: { message: "boom" } }
            : { data: h.blocked, error: null };
        if (name === "is_moderator") return { data: h.staff, error: null };
        if (name === "age_cohort_of") return { data: "adult", error: null };
        return { data: [], error: null };
      },
    },
  };
});

const { getPlayerCard } = await import("./player-card.functions");
const { optionalViewerId, hiddenByBlock } = await import("./viewer-blocks.server");
const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

type Card = { profile: { displayName: string; bio: string | null } | null; games: unknown[] };
const card = () =>
  (getPlayerCard as unknown as (a: { data: { userId: string } }) => Promise<Card>)({
    data: { userId: OWNER },
  });

beforeEach(() => {
  h.authorization = null;
  h.noRequest = false;
  h.claims = { "good-token": VIEWER };
  h.blocked = false;
  h.blockedError = false;
  h.staff = false;
  h.rpcCalls = [];
  h.queried = [];
});

describe("getPlayerCard and blocks", () => {
  it("an anonymous visitor sees a public card (no block lookup without a viewer)", async () => {
    expect((await card()).profile?.displayName).toBe("Alex");
    expect(h.rpcCalls).not.toContain("blocks_exist_between");
  });

  it("a signed-in viewer with no block sees the card", async () => {
    h.authorization = "Bearer good-token";
    expect((await card()).profile?.displayName).toBe("Alex");
    expect(h.rpcCalls).toContain("blocks_exist_between");
  });

  it("a viewer blocked either way gets the same empty answer as a private player, before any profile read", async () => {
    h.authorization = "Bearer good-token";
    h.blocked = true;
    const c = await card();
    expect(c.profile).toBeNull();
    expect(c.games).toEqual([]);
    expect(JSON.stringify(c)).not.toContain("Point guard");
    expect(h.queried).toEqual([]);
  });

  it("staff keep access to a card even with a block between them", async () => {
    h.authorization = "Bearer good-token";
    h.blocked = true;
    h.staff = true;
    expect((await card()).profile?.displayName).toBe("Alex");
  });

  it("a failed block lookup hides the card from the signed-in viewer (fail closed)", async () => {
    h.authorization = "Bearer good-token";
    h.blockedError = true;
    expect((await card()).profile).toBeNull();
  });

  it("an invalid token is treated as anonymous: the public card, nothing more", async () => {
    h.authorization = "Bearer forged";
    expect((await card()).profile?.displayName).toBe("Alex");
    expect(h.rpcCalls).not.toContain("blocks_exist_between");
  });
});

describe("optionalViewerId", () => {
  const admin = supabaseAdmin as never;
  it("reads the verified subject of a bearer token", async () => {
    h.authorization = "Bearer good-token";
    expect(await optionalViewerId(admin)).toBe(VIEWER);
  });
  it.each([
    ["no header", null],
    ["not a bearer token", "Basic abc"],
    ["an empty bearer token", "Bearer "],
    ["a token that does not verify", "Bearer forged"],
  ])("is null for %s", async (_n, header) => {
    h.authorization = header;
    expect(await optionalViewerId(admin)).toBeNull();
  });
  it("is null outside a request instead of throwing", async () => {
    h.noRequest = true;
    expect(await optionalViewerId(admin)).toBeNull();
  });
});

describe("hiddenByBlock", () => {
  const admin = supabaseAdmin as never;
  it("never hides a person from themselves", async () => {
    h.blocked = true;
    expect(await hiddenByBlock(admin, OWNER, OWNER)).toBe(false);
    expect(h.rpcCalls).toEqual([]);
  });
  it("hides when there is a block and the viewer is not staff; asks about staff only then", async () => {
    expect(await hiddenByBlock(admin, VIEWER, OWNER)).toBe(false);
    expect(h.rpcCalls).toEqual(["blocks_exist_between"]);
    h.blocked = true;
    expect(await hiddenByBlock(admin, VIEWER, OWNER)).toBe(true);
    h.staff = true;
    expect(await hiddenByBlock(admin, VIEWER, OWNER)).toBe(false);
  });
});

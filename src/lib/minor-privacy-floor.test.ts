/**
 * A player's public pages (the passport on /players/$userId and the public player card) must not
 * publish where a minor has been or will be. age_cohort_of answers "unknown" for an account with no
 * birthday, and a lookup can fail: both used to read as adult. These run the real server functions
 * with the database faked. A server function is its handler here: validate the input, then run it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isConfirmedMinorCohort, keepsMinorPrivacyFloor } from "./minor-privacy-floor";

const USER = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";
const FUTURE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 3 * 86_400_000).toISOString();

const h = vi.hoisted(() => ({
  cohort: { data: "adult" as unknown, error: null as null | { message: string } },
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
      handler(fn: (ctx: { data: unknown; context: unknown }) => unknown) {
        return (arg: { data: unknown; context: unknown }) =>
          fn({ data: validate(arg.data), context: arg.context });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

vi.mock("@/integrations/supabase/client.server", () => {
  const game = (id: string, date: string) => ({
    id,
    title: `Game ${id}`,
    sport: "Basketball",
    date,
    location: "Main St Gym, 12 Main St",
    is_private: false,
    hidden_at: null,
    org_hidden_at: null,
    cancelled_at: null,
    // An adult-only game: only those are public (isPublicGame).
    min_age: 18,
    max_age: null,
    host_id: USER,
    org_id: null,
  });
  const rows: Record<string, unknown[]> = {
    profiles: [
      {
        id: USER,
        display_name: "Sam",
        username: "sam",
        avatar_initials: "SA",
        suspended_at: null,
        moderation_state: null,
      },
    ],
    hosted_games: [game("past", PAST), game("next", FUTURE)],
    game_participants: [],
    team_members: [],
    tryout_rsvps: [],
    highlight_reels: [],
  };
  const query = (table: string) => {
    h.queried.push(table);
    const data = rows[table] ?? [];
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      is: () => q,
      in: () => q,
      gte: () => q,
      lt: () => q,
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
      rpc: async (name: string) => {
        if (name === "age_cohort_of") return h.cohort;
        if (name === "profile_visibility_of") return { data: "public", error: null };
        if (name === "blocks_exist_between") return { data: false, error: null };
        if (name === "public_xp_enabled") return { data: false, error: null };
        return { data: [], error: null };
      },
    },
  };
});

const { getPlayerCard } = await import("./player-card.functions");
const { getPlayerPassport } = await import("./player-passport.functions");
type Call = (arg: { data: { userId: string }; context: unknown }) => Promise<unknown>;
const runCard = () =>
  (getPlayerCard as unknown as Call)({ data: { userId: USER }, context: {} }) as Promise<{
    profile: { isMinor: boolean } | null;
    games: { id: string; location: string | null }[];
  }>;
const runPassport = () =>
  (getPlayerPassport as unknown as Call)({
    data: { userId: USER },
    context: { userId: VIEWER },
  }) as Promise<{ upcomingRuns: unknown[]; accolades: unknown[]; progress: unknown }>;

beforeEach(() => {
  h.cohort = { data: "adult", error: null };
  h.queried = [];
});

describe("keepsMinorPrivacyFloor", () => {
  it("only a confirmed adult lifts it", () => {
    expect(keepsMinorPrivacyFloor("adult")).toBe(false);
    for (const c of [
      "child_under_13",
      "teen_13_15",
      "teen_16_17",
      "unknown",
      null,
      undefined,
      "new",
    ]) {
      expect(keepsMinorPrivacyFloor(c)).toBe(true);
    }
  });

  it("a failed lookup keeps it, even with an adult answer", () => {
    expect(keepsMinorPrivacyFloor("adult", true)).toBe(true);
  });

  it("isConfirmedMinorCohort names only the three minor cohorts", () => {
    expect(["child_under_13", "teen_13_15", "teen_16_17"].every(isConfirmedMinorCohort)).toBe(true);
    for (const c of ["adult", "unknown", null, "new"])
      expect(isConfirmedMinorCohort(c)).toBe(false);
  });
});

describe("the public player card", () => {
  it("lists a confirmed adult's upcoming game with its venue", async () => {
    const res = await runCard();
    expect(res.games.map((g) => g.id).sort()).toEqual(["next", "past"]);
    expect(res.games.find((g) => g.id === "next")?.location).toContain("Main St");
    expect(res.profile?.isMinor).toBe(false);
  });

  it.each([
    ["no birthday (unknown)", { data: "unknown", error: null }],
    ["a failed age lookup", { data: null, error: { message: "timeout" } }],
  ])(
    "hides upcoming games and venues for %s, without calling them a guardian's athlete",
    async (_l, cohort) => {
      h.cohort = cohort as typeof h.cohort;
      const res = await runCard();
      expect(res.games.map((g) => g.id)).toEqual(["past"]);
      expect(res.games[0]?.location).toBeNull();
      expect(res.profile?.isMinor).toBe(false);
    },
  );

  it("a confirmed minor keeps the guardian badge and the floor", async () => {
    h.cohort = { data: "teen_16_17", error: null };
    const res = await runCard();
    expect(res.games.map((g) => g.id)).toEqual(["past"]);
    expect(res.profile?.isMinor).toBe(true);
  });
});

describe("the passport on /players/$userId", () => {
  it("reads attendance and runs for a confirmed adult", async () => {
    await runPassport();
    expect(h.queried).toContain("tryout_rsvps");
  });

  it.each([
    ["no birthday (unknown)", { data: "unknown", error: null }],
    ["a failed age lookup", { data: "adult", error: { message: "timeout" } }],
    ["a confirmed minor", { data: "teen_13_15", error: null }],
  ])("shows team badges only for %s", async (_l, cohort) => {
    h.cohort = cohort as typeof h.cohort;
    const res = await runPassport();
    expect(res).toMatchObject({ accolades: [], upcomingRuns: [], progress: null });
    expect(h.queried).not.toContain("tryout_rsvps");
    expect(h.queried).not.toContain("game_participants");
  });
});

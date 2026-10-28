import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Teams and Trainers tabs list whatever org-store holds. It used to start
 * with invented teams and coaches (Eastside Elite, Jordan Kim, ...), so a member
 * saw them mixed in with the real ones, with made-up follower counts, records
 * and rosters. Only what the server returns may be listed.
 */

const server = vi.hoisted(() => ({
  listTeams: vi.fn(),
}));

vi.mock("./teams.functions", () => ({
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  listTeams: server.listTeams,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "member-1" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
  },
}));

function row(over: Record<string, unknown> = {}) {
  return {
    id: "real-team",
    owner_id: "someone-else",
    kind: "team",
    name: "Real Team",
    handle: "realteam",
    tagline: "",
    city: "Atlanta, GA",
    founded: null,
    sports: ["Basketball"],
    bio: "",
    achievements: [],
    accent: "#a3ff12",
    avatar: "RT",
    cover: "",
    league: null,
    home_court: null,
    wins: 0,
    losses: 0,
    staff: [],
    credentials: [],
    rate_per_hour: null,
    skill_min: 1,
    skill_max: 5,
    followers: 0,
    verified: false,
    ...over,
  };
}

beforeEach(() => {
  vi.resetModules();
  server.listTeams.mockReset();
});

describe("org-store", () => {
  it("lists only the teams and coaches the server returned", async () => {
    server.listTeams.mockResolvedValue([row()]);
    const store = await import("./org-store");
    await store.hydrateOrgs();
    const { ORGS } = await import("./sample-data");
    expect(ORGS.map((o) => o.id)).toEqual(["real-team"]);
  });

  it("starts empty, so nothing invented shows while the real list loads", async () => {
    const { ORGS } = await import("./sample-data");
    expect(ORGS).toEqual([]);
  });
});

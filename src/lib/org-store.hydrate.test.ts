import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  listTeams: vi.fn(async () => [] as unknown[]),
}));

vi.mock("./teams.functions", () => ({
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  listTeams: state.listTeams,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
  },
}));

beforeEach(() => {
  state.user = null;
  state.listTeams.mockReset();
  state.listTeams.mockResolvedValue([]);
  vi.resetModules();
});

describe("hydrateOrgs", () => {
  it("does not ask for the team list without a session", async () => {
    const { hydrateOrgs, ensureOrgById } = await import("./org-store");
    await hydrateOrgs();
    expect(await ensureOrgById("t-1")).toBeUndefined();
    expect(state.listTeams).not.toHaveBeenCalled();
  });

  it("loads the list once someone is signed in, even after an earlier signed-out attempt", async () => {
    const { hydrateOrgs } = await import("./org-store");
    await hydrateOrgs();
    expect(state.listTeams).not.toHaveBeenCalled();

    state.user = { id: "u-1" };
    await hydrateOrgs();
    expect(state.listTeams).toHaveBeenCalledTimes(1);
  });
});

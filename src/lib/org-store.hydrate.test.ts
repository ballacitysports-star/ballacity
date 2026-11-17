import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  listTeams: vi.fn(async (_opts?: unknown) => [] as unknown[]),
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
      getSession: async () => ({
        data: { session: state.user ? { user: state.user, access_token: "token-1" } : null },
        error: null,
      }),
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

  it("sends the session's token with the team list call itself", async () => {
    // The first load can start while the app boots, before the global middleware that
    // attaches the token is installed; the call must not depend on it.
    state.user = { id: "u-1" };
    const { hydrateOrgs } = await import("./org-store");
    await hydrateOrgs();
    expect(state.listTeams).toHaveBeenCalledWith({
      headers: { Authorization: "Bearer token-1" },
    });
  });

  it("tries again on the next call after a failed load", async () => {
    state.user = { id: "u-1" };
    state.listTeams.mockRejectedValueOnce(new Error("Unauthorized"));
    state.listTeams.mockResolvedValueOnce([
      { id: "t-1", owner_id: "u-1", kind: "team", name: "Mine", handle: "mine" },
    ]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { hydrateOrgs, ensureOrgById, isMyOrg } = await import("./org-store");
    await hydrateOrgs();
    expect(state.listTeams).toHaveBeenCalledTimes(1);
    expect((await ensureOrgById("t-1"))?.id).toBe("t-1");
    expect(state.listTeams).toHaveBeenCalledTimes(2);
    expect(isMyOrg("t-1")).toBe(true);
    errors.mockRestore();
  });
});

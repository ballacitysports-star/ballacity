// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The team list is loaded once and then kept fresh by applying changes from the public:teams
 * channel. A list answered before the changes were live would miss a change for good, so the
 * channel opens with wait and every SUBSCRIBED loads the list again. Loads can overlap, so an
 * older answer must not merge over a newer one. The channel only opens in a browser, hence jsdom.
 */

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  listTeams: vi.fn(async (_opts?: unknown) => [] as unknown[]),
  opened: [] as Array<{ name: string; options: unknown }>,
  status: undefined as undefined | ((status: string) => void),
}));

vi.mock("./teams.functions", () => ({
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  listTeams: state.listTeams,
}));
vi.mock("@/integrations/supabase/client", () => {
  const channel = {
    on: () => channel,
    subscribe: (cb?: (status: string) => void) => {
      state.status = cb;
      return channel;
    },
  };
  return {
    supabase: {
      auth: {
        getSession: async () => ({
          data: { session: state.user ? { user: state.user, access_token: "token-1" } : null },
          error: null,
        }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      channel: (name: string, options?: unknown) => {
        state.opened.push({ name, options });
        return channel;
      },
    },
  };
});

const team = (name: string) => ({ id: "t-1", owner_id: "u-1", kind: "team", name, handle: "t1" });

/** Lets every pending promise callback run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  state.user = null;
  state.listTeams.mockReset();
  state.listTeams.mockResolvedValue([]);
  state.opened = [];
  state.status = undefined;
  vi.resetModules();
});

describe("org-store public:teams channel", () => {
  it("opens the channel holding SUBSCRIBED until changes are live, topic unchanged", async () => {
    await import("./org-store");
    expect(state.opened).toStrictEqual([
      { name: "public:teams", options: { config: { postgres_changes_options: { wait: true } } } },
    ]);
  });

  it("loads the team list again on every SUBSCRIBED, the first included", async () => {
    state.user = { id: "u-1" };
    state.listTeams.mockResolvedValueOnce([team("Before")]);
    const { hydrateOrgs, getOrgById } = await import("./org-store");
    await hydrateOrgs();
    expect(state.listTeams).toHaveBeenCalledTimes(1);

    // A rename made after the first list was read, before the changes were live.
    state.listTeams.mockResolvedValueOnce([team("After")]);
    state.status?.("SUBSCRIBED");
    await settle();
    expect(state.listTeams).toHaveBeenCalledTimes(2);
    expect(getOrgById("t-1")?.name).toBe("After");

    state.status?.("CHANNEL_ERROR");
    await settle();
    expect(state.listTeams).toHaveBeenCalledTimes(2);

    state.status?.("SUBSCRIBED");
    await settle();
    expect(state.listTeams).toHaveBeenCalledTimes(3);
  });

  it("does not ask for the team list on SUBSCRIBED while signed out", async () => {
    const { hydrateOrgs } = await import("./org-store");
    await hydrateOrgs();
    state.status?.("SUBSCRIBED");
    await settle();
    expect(state.listTeams).not.toHaveBeenCalled();
  });

  it("re-reads when the first load is still out, and keeps the newer answer", async () => {
    state.user = { id: "u-1" };
    let answerFirst: (rows: unknown[]) => void = () => {};
    state.listTeams.mockImplementationOnce(() => new Promise((r) => (answerFirst = r)));
    state.listTeams.mockResolvedValueOnce([team("Newer")]);
    const { hydrateOrgs, getOrgById } = await import("./org-store");
    const first = hydrateOrgs();
    await vi.waitFor(() => expect(state.listTeams).toHaveBeenCalledTimes(1));

    state.status?.("SUBSCRIBED");
    await vi.waitFor(() => expect(state.listTeams).toHaveBeenCalledTimes(2));
    await settle();
    expect(getOrgById("t-1")?.name).toBe("Newer");

    // The first call answers last, with the list as it was before.
    answerFirst([team("Older")]);
    await first;
    expect(getOrgById("t-1")?.name).toBe("Newer");
  });
});

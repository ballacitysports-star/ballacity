import { beforeEach, describe, expect, it, vi } from "vitest";

type Res = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Res => ({ data, error: null });
const failed = (): Res => ({ data: null, error: { message: "network down" } });

const state = vi.hoisted(() => ({
  accountProfiles: null as unknown,
  me: null as unknown,
  ownedTeams: null as unknown,
  ownedOrgs: null as unknown,
  teamsByRef: null as unknown,
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => ({
    select: (cols: string) => {
      const result = (): Res => {
        if (table === "account_profiles") return state.accountProfiles as Res;
        if (table === "profiles") return state.me as Res;
        if (table === "teams")
          return (cols === "id, kind" ? state.ownedTeams : state.teamsByRef) as Res;
        if (table === "trainer_orgs") return (cols === "id" ? state.ownedOrgs : ok([])) as Res;
        return ok([]);
      };
      const c: Record<string, unknown> = {};
      for (const m of ["eq", "in", "order"]) c[m] = () => c;
      c.maybeSingle = async () => {
        const r = result();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      };
      c.then = (resolve: (r: Res) => unknown) => resolve(result());
      return c;
    },
    insert: () => ({ select: () => ({ maybeSingle: async () => ok({ id: "new-row" }) }) }),
    update: (patch: Record<string, unknown>) => ({
      eq: async () => {
        state.updates.push(patch);
        return { error: null };
      },
    }),
  });
  return { supabase: { from } };
});

import { fetchMyProfiles } from "@/lib/account-profiles";

const PLAYER = "p-1";
const TRAINER = "t-1";

beforeEach(() => {
  state.updates = [];
  state.accountProfiles = ok([
    { id: PLAYER, kind: "player", ref_id: null, created_at: "2026-09-11" },
    { id: TRAINER, kind: "trainer", ref_id: "c-john", created_at: "2026-10-23" },
  ]);
  state.me = ok({
    display_name: "BallaCity",
    username: null,
    avatar_url: null,
    avatar_initials: "BC",
    active_profile_id: TRAINER,
    default_profile_id: null,
    account_type: "trainer",
  });
  state.ownedTeams = ok([{ id: "c-john", kind: "coach" }]);
  state.ownedOrgs = ok([]);
  state.teamsByRef = ok([
    { id: "c-john", name: "John Ohtani", handle: "john", avatar: "", avatar_url: null },
  ]);
});

describe("fetchMyProfiles keeps the profile you chose", () => {
  it("a trainer who chose the trainer profile stays on it, and nothing is rewritten", async () => {
    const r = await fetchMyProfiles("u1");
    expect(r.activeId).toBe(TRAINER);
    expect(r.active?.kind).toBe("trainer");
    expect(state.updates).toEqual([]);
  });

  it("a failed lookup of the trainer's listing does not reset the account to player", async () => {
    state.teamsByRef = failed();
    const r = await fetchMyProfiles("u1");
    // For this one render the trainer profile cannot be shown, so the player profile stands in...
    expect(r.active?.kind).toBe("player");
    // ...but the saved choice is left alone, so the next successful load is back on the trainer.
    expect(state.updates).toEqual([]);
  });

  it.each([
    ["the account's profile rows", "accountProfiles"],
    ["the account row", "me"],
    ["the list of teams it owns", "ownedTeams"],
    ["the list of facilities it owns", "ownedOrgs"],
  ])("a failed read of %s never rewrites the saved profile", async (_n, key) => {
    (state as Record<string, unknown>)[key] = failed();
    await fetchMyProfiles("u1");
    expect(state.updates).toEqual([]);
  });

  it("a trainer listing that really is gone still falls back to player and repairs the row", async () => {
    state.teamsByRef = ok([]);
    state.ownedTeams = ok([]);
    const r = await fetchMyProfiles("u1");
    expect(r.active?.kind).toBe("player");
    expect(state.updates).toEqual([{ active_profile_id: PLAYER, account_type: "player" }]);
  });

  it("a stale starred default is still cleared when the reads succeeded", async () => {
    (state.me as { data: Record<string, unknown> }).data = {
      ...(state.me as { data: Record<string, unknown> }).data,
      active_profile_id: PLAYER,
      default_profile_id: "gone-id",
      account_type: "player",
    };
    await fetchMyProfiles("u1");
    expect(state.updates).toEqual([{ default_profile_id: null }]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * listOrgMembers: the facility member list is read as the caller. org_members has
 * no anon grant and its only read rule is TO authenticated, so a signed-out caller
 * gets an empty list without a database call, a signed-in one is read with their
 * own bearer client, and a database refusal reaches the UI with its code intact.
 */

// A server function is its handler for these tests.
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
        return async (arg: { data?: unknown; context?: unknown } = {}) =>
          fn({ data: validate(arg.data), context: arg.context });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

type Call = {
  table: string;
  select?: string;
  eq?: [string, unknown];
  in?: [string, unknown];
  args?: Record<string, unknown>;
};
type Result = { data: unknown; error: unknown };

const env = vi.hoisted(() => ({
  /** The Authorization header on the incoming request (null: signed out). */
  authorization: null as string | null,
  /** The Authorization header each created client was given. */
  clients: [] as Array<string | null>,
  /** Every query any client made, in order. */
  calls: [] as Call[],
  /** What each table answers. */
  results: {} as Record<string, Result>,
  /** What each database function answers (default: missing, as before 20261125100000). */
  rpcResults: {} as Record<string, Result>,
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({
    headers: new Headers(env.authorization ? { authorization: env.authorization } : {}),
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (
    _url: string,
    _key: string,
    opts?: { global?: { headers?: Record<string, string> } },
  ) => {
    env.clients.push(opts?.global?.headers?.Authorization ?? null);
    return {
      rpc: (fn: string, args: Record<string, unknown>) => {
        env.calls.push({ table: `rpc:${fn}`, args });
        return Promise.resolve(
          env.rpcResults[fn] ?? {
            data: null,
            error: { code: "PGRST202", message: `Could not find the function public.${fn}` },
          },
        );
      },
      from: (table: string) => {
        const call: Call = { table };
        env.calls.push(call);
        const q: Record<string, unknown> = {};
        q.select = (cols: string) => {
          call.select = cols;
          return q;
        };
        q.eq = (col: string, v: unknown) => {
          call.eq = [col, v];
          return q;
        };
        q.in = (col: string, v: unknown) => {
          call.in = [col, v];
          return q;
        };
        q.order = () => q;
        q.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(env.results[table] ?? { data: [], error: null }).then(resolve, reject);
        return q;
      },
    };
  },
}));

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

const { listOrgMembers } = await import("./trainer-orgs.functions");

const ORG = "11111111-1111-4111-8111-111111111111";
const U1 = "22222222-2222-4222-8222-222222222222";
const U2 = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  env.authorization = null;
  env.clients = [];
  env.calls = [];
  env.results = {};
  env.rpcResults = {};
});

describe("listOrgMembers", () => {
  it("returns an empty list to a signed-out visitor without reading org_members", async () => {
    const rows = await listOrgMembers({ data: { orgId: ORG } });
    expect(rows).toEqual([]);
    expect(env.calls).toEqual([]);
  });

  it("reads members and profiles with the caller's own bearer client", async () => {
    env.authorization = "Bearer user-jwt";
    env.results.org_members = {
      data: [
        { id: "m1", org_id: ORG, user_id: U1, role: "admin", created_at: "2026-11-01" },
        { id: "m2", org_id: ORG, user_id: U2, role: "member", created_at: "2026-11-02" },
      ],
      error: null,
    };
    env.results.profiles = {
      data: [{ id: U1, display_name: "Ana", avatar_initials: "AN", avatar_url: null }],
      error: null,
    };

    const rows = await listOrgMembers({ data: { orgId: ORG } });

    // Every client made for this call carries the caller's bearer, none the anon key alone.
    expect(env.clients.length).toBeGreaterThan(0);
    expect(env.clients.every((h) => h === "Bearer user-jwt")).toBe(true);
    // U2's row was left out; nothing else is asked for it.
    expect(env.calls.map((c) => c.table)).toEqual(["org_members", "profiles"]);
    expect(env.calls[0].eq).toEqual(["org_id", ORG]);
    expect(env.calls[1].in).toEqual(["id", [U1, U2]]);
    expect(rows).toEqual([
      {
        id: "m1",
        org_id: ORG,
        user_id: U1,
        role: "admin",
        created_at: "2026-11-01",
        profile: { id: U1, display_name: "Ana", avatar_initials: "AN", avatar_url: null },
      },
      {
        id: "m2",
        org_id: ORG,
        user_id: U2,
        role: "member",
        created_at: "2026-11-02",
        // A profile the viewer may not read renders as a neutral "Member".
        profile: null,
      },
    ]);
  });

  it("shows a blocked or suspended member as a neutral Member, for the facility admin too", async () => {
    env.authorization = "Bearer admin-jwt";
    env.results.org_members = {
      data: [{ id: "m2", org_id: ORG, user_id: U2, role: "member", created_at: "2026-11-02" }],
      error: null,
    };
    // The block hides U2's profile row from the admin. A membership is no
    // reason to name them (an admin can add any adult without consent), so
    // managed_profile_names is not asked and the row stays unnamed.
    env.results.profiles = { data: [], error: null };
    env.rpcResults.managed_profile_names = {
      data: [
        { id: U2, display_name: "Bo", username: "bo", avatar_initials: "BO", avatar_url: null },
      ],
      error: null,
    };

    const rows = await listOrgMembers({ data: { orgId: ORG } });
    expect(rows[0].profile).toBeNull();
    expect(env.calls.map((c) => c.table)).toEqual(["org_members", "profiles"]);
  });

  it("asks for no extra names when every profile was read", async () => {
    env.authorization = "Bearer user-jwt";
    env.results.org_members = {
      data: [{ id: "m1", org_id: ORG, user_id: U1, role: "admin", created_at: "2026-11-01" }],
      error: null,
    };
    env.results.profiles = {
      data: [{ id: U1, display_name: "Ana", avatar_initials: "AN", avatar_url: null }],
      error: null,
    };
    await listOrgMembers({ data: { orgId: ORG } });
    expect(env.calls.map((c) => c.table)).toEqual(["org_members", "profiles"]);
  });

  it("rethrows the database error itself, keeping its code", async () => {
    env.authorization = "Bearer user-jwt";
    const pgError = {
      message: "permission denied for table org_members",
      code: "42501",
      details: null,
      hint: null,
    };
    env.results.org_members = { data: null, error: pgError };

    await expect(listOrgMembers({ data: { orgId: ORG } })).rejects.toBe(pgError);
    expect(env.calls.map((c) => c.table)).toEqual(["org_members"]);
  });
});

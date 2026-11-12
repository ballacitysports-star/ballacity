import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * adminSetRole: the admin panel's "Make admin" / "Revoke moderator" buttons. Every grant and
 * revoke leaves an admin_audit_log row (through writeAudit, as superadminSetRole does), a failed
 * write, or a revoke that removes no role, is an error instead of a success, and only admins may
 * call it.
 */

// A server function is its handler for these tests: validate the input, then run it with the
// context the auth middleware would have given it.
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
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => null }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

type Row = Record<string, unknown>;
type Write = { table: string; op: "insert" | "delete"; row?: Row; eq?: Row };
type Result = { data: unknown; error: { message: string } | null };

const db = vi.hoisted(() => ({
  /** Every write the service-role client receives, in order. */
  writes: [] as Write[],
  /** The error a user_roles write returns (null: it succeeds). */
  roleError: null as { message: string } | null,
  /** The user_roles rows that exist: a delete removes the ones its filters match. */
  roleRows: [] as Row[],
}));

/** Awaitable like a supabase-js query: resolves to `{ data, error }`. */
const settled = <T extends object>(q: T, result: () => Result) =>
  Object.assign(q, {
    then: (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject),
  });

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const outcome = (): Result =>
        table === "user_roles" ? { data: null, error: db.roleError } : { data: null, error: null };
      return {
        insert: (row: Row) => {
          db.writes.push({ table, op: "insert", row });
          const q: Row = {};
          q.select = () => q;
          return settled(q, outcome);
        },
        delete: () => {
          const eq: Row = {};
          db.writes.push({ table, op: "delete", eq });
          let returning = false;
          const q: Row = {};
          q.eq = (col: string, value: unknown) => {
            eq[col] = value;
            return q;
          };
          // As in PostgREST, the removed rows come back only when asked for with .select().
          q.select = () => {
            returning = true;
            return q;
          };
          return settled(q, () => {
            const result = outcome();
            if (result.error) return result;
            const removed = db.roleRows.filter((r) =>
              Object.entries(eq).every(([col, value]) => r[col] === value),
            );
            return { data: returning ? removed : null, error: null };
          });
        },
      };
    },
  },
}));

import { adminSetRole } from "@/lib/admin.functions";

type Context = { supabase: { rpc: (...args: unknown[]) => Promise<unknown> }; userId: string };
const setRole = adminSetRole as unknown as (arg: {
  data: { userId: string; role: string; grant: boolean };
  context: Context;
}) => Promise<unknown>;

const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
/** The id of the user_roles row a test gives the target. */
const ROLE_ROW = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** The caller's context; `isAdmin` is what has_role(caller, 'admin') answers. */
function caller(isAdmin: boolean): Context {
  return {
    supabase: { rpc: vi.fn(async (..._args: unknown[]) => ({ data: isAdmin, error: null })) },
    userId: ACTOR,
  };
}

const auditRows = () =>
  db.writes.filter((w) => w.table === "admin_audit_log").map((w) => w.row as Row);
const roleWrites = () => db.writes.filter((w) => w.table === "user_roles");

beforeEach(() => {
  db.writes.length = 0;
  db.roleError = null;
  db.roleRows = [];
});

describe("adminSetRole audit trail", () => {
  it("grants the role, then records who granted what to whom", async () => {
    await expect(
      setRole({ data: { userId: TARGET, role: "admin", grant: true }, context: caller(true) }),
    ).resolves.toEqual({ ok: true });

    expect(roleWrites()).toEqual([
      { table: "user_roles", op: "insert", row: { user_id: TARGET, role: "admin" } },
    ]);
    expect(auditRows()).toEqual([
      {
        actor_id: ACTOR,
        action: "role.grant",
        target_type: "user",
        target_id: TARGET,
        reason: null,
        before: null,
        after: { role: "admin" },
        metadata: { source: "admin_panel" },
      },
    ]);
    // The audit row follows the change it records.
    expect(db.writes.map((w) => w.table)).toEqual(["user_roles", "admin_audit_log"]);
  });

  it("revokes the role, then records the revoke", async () => {
    db.roleRows = [{ id: ROLE_ROW, user_id: TARGET, role: "moderator" }];
    await expect(
      setRole({ data: { userId: TARGET, role: "moderator", grant: false }, context: caller(true) }),
    ).resolves.toEqual({ ok: true });

    expect(roleWrites()).toEqual([
      { table: "user_roles", op: "delete", eq: { user_id: TARGET, role: "moderator" } },
    ]);
    expect(auditRows()).toEqual([
      {
        actor_id: ACTOR,
        action: "role.revoke",
        target_type: "user",
        target_id: TARGET,
        reason: null,
        before: null,
        after: { role: "moderator" },
        metadata: { source: "admin_panel" },
      },
    ]);
    expect(db.writes.map((w) => w.table)).toEqual(["user_roles", "admin_audit_log"]);
  });
});

describe("adminSetRole failed writes", () => {
  it("reports a failed grant as an error and audits nothing", async () => {
    db.roleError = { message: "duplicate key value violates unique constraint" };
    await expect(
      setRole({ data: { userId: TARGET, role: "admin", grant: true }, context: caller(true) }),
    ).rejects.toThrow(
      "Could not grant the admin role: duplicate key value violates unique constraint",
    );
    expect(roleWrites()).toHaveLength(1);
    expect(auditRows()).toEqual([]);
  });

  it("reports a failed revoke as an error and audits nothing", async () => {
    db.roleError = { message: "connection reset" };
    await expect(
      setRole({ data: { userId: TARGET, role: "moderator", grant: false }, context: caller(true) }),
    ).rejects.toThrow("Could not revoke the moderator role: connection reset");
    expect(roleWrites()).toHaveLength(1);
    expect(auditRows()).toEqual([]);
  });

  it("reports a revoke of a role the user does not have as an error and audits nothing", async () => {
    // The user is an admin but not a moderator: the delete matches no row and returns no error.
    db.roleRows = [{ id: ROLE_ROW, user_id: TARGET, role: "admin" }];
    await expect(
      setRole({ data: { userId: TARGET, role: "moderator", grant: false }, context: caller(true) }),
    ).rejects.toThrow("This user does not have the moderator role.");
    expect(roleWrites()).toEqual([
      { table: "user_roles", op: "delete", eq: { user_id: TARGET, role: "moderator" } },
    ]);
    expect(auditRows()).toEqual([]);
  });
});

describe("adminSetRole callers", () => {
  it("still refuses a caller who is not an admin, before any write", async () => {
    const ctx = caller(false);
    await expect(
      setRole({ data: { userId: TARGET, role: "admin", grant: true }, context: ctx }),
    ).rejects.toThrow("Forbidden");
    expect(ctx.supabase.rpc).toHaveBeenCalledWith("has_role", { _user_id: ACTOR, _role: "admin" });
    expect(db.writes).toEqual([]);
  });

  it("still lets an admin grant only admin or moderator, never superadmin", async () => {
    const ctx = caller(true);
    await expect(
      setRole({ data: { userId: TARGET, role: "superadmin", grant: true }, context: ctx }),
    ).rejects.toThrow();
    // Refused by the input check, before the role check or any write.
    expect(ctx.supabase.rpc).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });
});

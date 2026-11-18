import { beforeEach, describe, expect, it, vi } from "vitest";

// addOrgMemberDirect tells the new member they were added. The notifications
// insert policy only lets a signed-in client write its own rows, so the row for
// someone else is written with the service role, and only once the caller has
// been shown to be an admin of the org.

// A server function is its handler for these tests: validate, then run with the given context.
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
        return (arg: { data?: unknown; context?: unknown }) =>
          fn({ data: validate(arg?.data), context: arg?.context });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

type Result = { data?: unknown; error: { message: string } | null };
const db = {
  isAdmin: true,
  orgName: "Downtown Hoops" as string | null,
  noteError: null as { message: string } | null,
  inserted: [] as { who: "admin" | "user"; table: string; row: unknown }[],
  pushes: [] as unknown[],
};

const chain = (result: () => Result) => {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => result();
  c.single = async () => result();
  c.then = (resolve: (r: Result) => unknown) => resolve(result());
  return c;
};

const clientFor = (who: "admin" | "user") => ({
  rpc: async (fn: string) => {
    if (fn === "is_trainer_org_admin") return { data: db.isAdmin, error: null };
    return { data: null, error: null };
  },
  from: (table: string) => {
    const c = chain(() =>
      table === "trainer_orgs"
        ? { data: db.orgName ? { name: db.orgName } : null, error: null }
        : { data: null, error: null },
    );
    c.insert = (row: unknown) => {
      db.inserted.push({ who, table, row });
      const error = table === "notifications" ? db.noteError : null;
      // The signed-in client is refused a row for someone else, as the RLS policy refuses it.
      const refused =
        who === "user" && table === "notifications"
          ? { message: "new row violates row-level security policy" }
          : null;
      return chain(() => ({ data: error ? null : { id: "note-1" }, error: refused ?? error }));
    };
    return c;
  },
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: clientFor("admin") }));
vi.mock("@/lib/push.server", () => ({
  deliverPush: async (p: unknown) => {
    db.pushes.push(p);
    return { ok: true as const };
  },
}));

import { addOrgMemberDirect } from "@/lib/trainer-orgs.functions";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000001";
const call = () =>
  addOrgMemberDirect({
    data: { orgId: ORG, userId: MEMBER },
    context: { userId: ADMIN, supabase: clientFor("user") },
  } as never);

beforeEach(() => {
  db.isAdmin = true;
  db.orgName = "Downtown Hoops";
  db.noteError = null;
  db.inserted = [];
  db.pushes = [];
});

describe("addOrgMemberDirect notifies the new member", () => {
  it("writes the notification for the new member with the service role, and pushes it", async () => {
    expect(await call()).toEqual({ ok: true });
    expect(db.inserted).toEqual([
      {
        who: "user",
        table: "org_members",
        row: { org_id: ORG, user_id: MEMBER, role: "member" },
      },
      {
        who: "admin",
        table: "notifications",
        row: {
          user_id: MEMBER,
          type: "org_membership",
          title: "You were added to Downtown Hoops",
          body: "An admin added you as a member.",
          link: `/orgs/${ORG}`,
        },
      },
    ]);
    expect(db.pushes).toEqual([
      {
        userId: MEMBER,
        title: "You were added to Downtown Hoops",
        body: "An admin added you as a member.",
        url: `/orgs/${ORG}`,
        notificationId: "note-1",
      },
    ]);
  });

  it("writes nothing when the caller is not an org admin", async () => {
    db.isAdmin = false;
    await expect(call()).rejects.toThrow("Only owners or admins can perform this action.");
    expect(db.inserted).toEqual([]);
    expect(db.pushes).toEqual([]);
  });

  it("logs a failed notification insert, does not push, and keeps the membership", async () => {
    db.noteError = { message: "boom" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await call()).toEqual({ ok: true });
    expect(err).toHaveBeenCalledWith("[orgs] org_membership notification insert failed", "boom");
    expect(db.pushes).toEqual([]);
    err.mockRestore();
  });
});

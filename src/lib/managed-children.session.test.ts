/**
 * startManagedSession: the guardian switching into a managed account. What matters here is the repair of a sign-in record a
 * half-finished handover left behind (docs/managed-account-handover.md section 2a): it is tried once, only after the database
 * has said this guardian manages the account, and a record that stays wrong is refused exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type U = { id: string; email: string; app_metadata: Record<string, unknown> };

const h = vi.hoisted(() => ({
  managedRow: true as boolean,
  users: [] as (U | null)[],
  reads: 0,
  links: [] as string[],
  reconciled: [] as string[],
  reconcileResult: "repaired" as string,
  reconcileThrows: false,
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
      handler(fn: (ctx: { context: unknown; data: unknown }) => unknown) {
        return (arg: { data: unknown }) =>
          fn({
            context: {
              userId: "guardian",
              claims: {},
              supabase: {
                from: (table: string) => {
                  const q: Record<string, unknown> = {};
                  q.select = () => q;
                  q.eq = () => q;
                  q.maybeSingle = async () => ({
                    data:
                      table === "profiles"
                        ? { age_cohort: "adult" }
                        : h.managedRow
                          ? { child_user_id: CHILD }
                          : null,
                  });
                  return q;
                },
                rpc: async () => ({ data: null }),
              },
            },
            data: validate(arg.data),
          });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: h.users[Math.min(h.reads++, h.users.length - 1)] },
        }),
        generateLink: async ({ email }: { email: string }) => {
          h.links.push(email);
          return { data: { properties: { hashed_token: "tok" } }, error: null };
        },
      },
    },
    from: () => ({ insert: async () => ({}) }),
  },
}));
vi.mock("@/lib/managed-handover.server", () => ({
  reconcileManagedRecord: async (id: string) => {
    h.reconciled.push(id);
    if (h.reconcileThrows) throw new Error("boom");
    return h.reconcileResult;
  },
}));

const CHILD = "11111111-1111-4111-8111-111111111111";
const { startManagedSession } = (await import("./managed-children.functions")) as unknown as {
  startManagedSession: (a: { data: { childUserId: string } }) => Promise<{ tokenHash: string }>;
};

const placeholder: U = {
  id: CHILD,
  email: "mabc@managed.invalid",
  app_metadata: { managed: true, managed_by: "guardian" },
};
const halfDone: U = { id: CHILD, email: "adult@example.test", app_metadata: { managed: false } };

beforeEach(() => {
  h.managedRow = true;
  h.users = [placeholder];
  h.reads = 0;
  h.links.length = 0;
  h.reconciled.length = 0;
  h.reconcileResult = "repaired";
  h.reconcileThrows = false;
});

describe("startManagedSession", () => {
  it("switches in without touching the repair when the record is the managed placeholder", async () => {
    expect(await startManagedSession({ data: { childUserId: CHILD } })).toEqual({
      tokenHash: "tok",
    });
    expect(h.reconciled).toEqual([]);
    expect(h.links).toEqual(["mabc@managed.invalid"]);
  });

  it("repairs a half-finished handover's record once, then switches in", async () => {
    h.users = [halfDone, { ...placeholder, email: "mnew@managed.invalid" }];
    expect(await startManagedSession({ data: { childUserId: CHILD } })).toEqual({
      tokenHash: "tok",
    });
    expect(h.reconciled).toEqual([CHILD]);
    expect(h.links).toEqual(["mnew@managed.invalid"]);
  });

  it.each([["busy"], ["not_managed"], ["unknown"]])(
    "refuses as before when the repair says %s (a handover is being finished, or it is finished, or nothing could be read)",
    async (result) => {
      h.users = [halfDone];
      h.reconcileResult = result;
      await expect(startManagedSession({ data: { childUserId: CHILD } })).rejects.toThrow();
      expect(h.links).toEqual([]);
    },
  );

  it("refuses as before when the repair itself throws, and when the record is still wrong after it", async () => {
    h.users = [halfDone];
    h.reconcileThrows = true;
    await expect(startManagedSession({ data: { childUserId: CHILD } })).rejects.toThrow();
    h.reconcileThrows = false;
    h.users = [halfDone, halfDone];
    await expect(startManagedSession({ data: { childUserId: CHILD } })).rejects.toThrow();
    expect(h.links).toEqual([]);
  });

  it("never asks for a repair, or reads the sign-in record, for an account this guardian does not manage", async () => {
    h.managedRow = false;
    h.users = [halfDone];
    await expect(startManagedSession({ data: { childUserId: CHILD } })).rejects.toThrow();
    expect(h.reconciled).toEqual([]);
    expect(h.reads).toBe(0);
  });

  it("does not switch into a record that names another guardian, even after a repair", async () => {
    const other = { ...placeholder, app_metadata: { managed: true, managed_by: "someone-else" } };
    h.users = [other, other];
    await expect(startManagedSession({ data: { childUserId: CHILD } })).rejects.toThrow();
    expect(h.links).toEqual([]);
  });
});

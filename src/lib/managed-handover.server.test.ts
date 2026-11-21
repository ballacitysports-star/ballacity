/**
 * The adult's side of a handover (managed-handover.server.ts), with the service role and the auth Admin API mocked. What
 * matters here is the order of the steps and that every failure leaves the account managed and linked: the sign-in record
 * is put back, the claim is released, and the database is never asked to finish what the sign-in record does not show.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as string[],
  rpc: {} as Record<string, (args: Record<string, unknown>) => { data?: unknown; error?: unknown }>,
  user: null as { id: string; email: string; app_metadata: Record<string, unknown> } | null,
  getError: null as unknown,
  updateError: null as unknown,
  putBackError: null as unknown,
  updates: [] as Record<string, unknown>[],
  linkError: null as unknown,
  linkHash: "recovery-hash" as string | null,
  reports: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.calls.push(`rpc:${name}`);
      const f = h.rpc[name];
      return f ? f(args) : { data: null, error: null };
    },
    auth: {
      admin: {
        getUserById: async () => {
          h.calls.push("auth:get");
          return { data: { user: h.user }, error: h.getError };
        },
        updateUserById: async (_id: string, attrs: Record<string, unknown>) => {
          h.calls.push("auth:update");
          h.updates.push(attrs);
          // The first update is the adult's; a failure is injected only for it, so a put-back can be seen to run.
          if (h.updateError && h.updates.length === 1) return { data: null, error: h.updateError };
          if (h.putBackError && h.updates.length === 2)
            return { data: null, error: h.putBackError };
          return { data: { user: h.user }, error: null };
        },
        generateLink: async () => {
          h.calls.push("auth:link");
          return {
            data: { properties: h.linkHash ? { hashed_token: h.linkHash } : null },
            error: h.linkError,
          };
        },
      },
    },
  },
}));
vi.mock("@/lib/server-fn-report.server", () => ({
  reportServerFnError: async (e: unknown) => {
    h.reports.push(e);
  },
}));

const { completeHandover, hashHandoverToken, lookupHandover, newHandoverToken } =
  await import("./managed-handover.server");

const TOKEN = "t".repeat(64);
const PLACEHOLDER = "mabc@managed.invalid";

beforeEach(() => {
  h.calls.length = 0;
  h.updates.length = 0;
  h.reports.length = 0;
  h.updateError = null;
  h.putBackError = null;
  h.getError = null;
  h.linkError = null;
  h.linkHash = "recovery-hash";
  h.user = {
    id: "child",
    email: PLACEHOLDER,
    app_metadata: { managed: true, managed_by: "guardian" },
  };
  h.rpc = {
    claim_managed_handover: () => ({
      data: {
        ok: true,
        child_user_id: "child",
        managed_by: "guardian",
        email: "adult@example.test",
      },
      error: null,
    }),
    finish_managed_handover: () => ({ data: { ok: true, child_user_id: "child" }, error: null }),
    release_managed_handover: () => ({ data: null, error: null }),
  };
});

describe("tokens", () => {
  it("makes a 64-character hex token and stores only its hash", () => {
    const a = newHandoverToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newHandoverToken()).not.toBe(a);
    expect(hashHandoverToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashHandoverToken(a)).not.toContain(a);
    expect(hashHandoverToken(a)).toBe(hashHandoverToken(a));
  });
});

describe("lookupHandover", () => {
  it("answers with the names and a masked address, never the address", async () => {
    h.rpc.managed_handover_lookup = (args) => {
      expect(args._token_hash).toBe(hashHandoverToken(TOKEN));
      return {
        data: {
          valid: true,
          child_name: "Jake S.",
          guardian_name: "Alex",
          email_masked: "a***@example.test",
          expires_at: "2026-11-28T10:00:00Z",
        },
        error: null,
      };
    };
    const r = await lookupHandover(TOKEN);
    expect(r).toEqual({
      valid: true,
      childName: "Jake S.",
      guardianName: "Alex",
      emailMasked: "a***@example.test",
      expiresAt: "2026-11-28T10:00:00Z",
    });
    expect(JSON.stringify(r)).not.toContain("adult@");
  });

  it("reads a dead link, an expired one and a failing read as not valid, never as an error", async () => {
    h.rpc.managed_handover_lookup = () => ({
      data: { valid: false, code: "HANDOVER_EXPIRED" },
      error: null,
    });
    expect(await lookupHandover(TOKEN)).toEqual({ valid: false, code: "HANDOVER_EXPIRED" });
    h.rpc.managed_handover_lookup = () => ({ data: { valid: false }, error: null });
    expect(await lookupHandover(TOKEN)).toEqual({ valid: false, code: "HANDOVER_INVALID" });
    h.rpc.managed_handover_lookup = () => ({
      data: null,
      error: { code: "PGRST202", message: "missing function" },
    });
    expect(await lookupHandover(TOKEN)).toEqual({ valid: false, code: "HANDOVER_INVALID" });
  });
});

describe("completeHandover", () => {
  it("claims, puts the adult's confirmed address on the sign-in record, finishes, then makes a sign-in link, in that order", async () => {
    const done = await completeHandover(TOKEN);
    expect(done).toEqual({ recoveryTokenHash: "recovery-hash", childUserId: "child" });
    expect(h.calls).toEqual([
      "rpc:claim_managed_handover",
      "auth:get",
      "auth:update",
      "rpc:finish_managed_handover",
      "auth:link",
    ]);
    expect(h.updates).toEqual([
      {
        email: "adult@example.test",
        email_confirm: true,
        app_metadata: { managed: false, managed_by: null },
      },
    ]);
  });

  it("stops at a claim the database refuses, touching nothing", async () => {
    h.rpc.claim_managed_handover = () => ({
      data: { ok: false, code: "HANDOVER_EXPIRED" },
      error: null,
    });
    await expect(completeHandover(TOKEN)).rejects.toThrow(/expired/i);
    expect(h.calls).toEqual(["rpc:claim_managed_handover"]);
    h.calls.length = 0;
    h.rpc.claim_managed_handover = () => ({
      data: { ok: false, code: "HANDOVER_BUSY" },
      error: null,
    });
    await expect(completeHandover(TOKEN)).rejects.toThrow(/right now/i);
    expect(h.calls).toEqual(["rpc:claim_managed_handover"]);
  });

  it("says 'not available' while the migration is missing, never raw text", async () => {
    h.rpc.claim_managed_handover = () => ({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.claim_managed_handover",
      },
    });
    const err = await completeHandover(TOKEN).catch((e: Error) => e);
    expect((err as Error).message).toBe(
      "Handing over an account isn't available yet. Please try again later.",
    );
    expect((err as Error).message).not.toMatch(/function|public\./);
    expect(h.calls).toEqual(["rpc:claim_managed_handover"]);
  });

  it.each([
    [
      "the account is not managed any more",
      { id: "child", email: "adult@example.test", app_metadata: {} },
    ],
    [
      "the sign-in record names a different guardian",
      {
        id: "child",
        email: PLACEHOLDER,
        app_metadata: { managed: true, managed_by: "someone-else" },
      },
    ],
    [
      "the sign-in record has a real address, not the placeholder",
      {
        id: "child",
        email: "real@example.test",
        app_metadata: { managed: true, managed_by: "guardian" },
      },
    ],
  ])("refuses, changing nothing and releasing the claim, when %s", async (_why, user) => {
    h.user = user;
    await expect(completeHandover(TOKEN)).rejects.toThrow(/nothing was changed/i);
    expect(h.calls).toEqual([
      "rpc:claim_managed_handover",
      "auth:get",
      "rpc:release_managed_handover",
    ]);
    expect(h.updates).toEqual([]);
  });

  it("releases the claim and stops, before the database is asked to finish, when the sign-in record will not update", async () => {
    h.updateError = { message: "email address already registered" };
    await expect(completeHandover(TOKEN)).rejects.toThrow(/nothing was changed/i);
    expect(h.calls).toEqual([
      "rpc:claim_managed_handover",
      "auth:get",
      "auth:update",
      "rpc:release_managed_handover",
    ]);
    expect(h.calls).not.toContain("rpc:finish_managed_handover");
  });

  it("puts the sign-in record back when the database refuses to finish: placeholder address, managed again", async () => {
    h.rpc.finish_managed_handover = () => ({
      data: { ok: false, code: "HANDOVER_FAILED" },
      error: null,
    });
    await expect(completeHandover(TOKEN)).rejects.toThrow(/nothing was changed/i);
    expect(h.updates).toHaveLength(2);
    expect(h.updates[1]).toEqual({
      email: PLACEHOLDER,
      email_confirm: true,
      app_metadata: { managed: true, managed_by: "guardian" },
    });
    expect(h.calls.slice(-2)).toEqual(["auth:update", "rpc:release_managed_handover"]);
    expect(h.calls).not.toContain("auth:link");
  });

  it("does the same, and reports the failure, when the database call itself fails", async () => {
    h.rpc.finish_managed_handover = () => ({
      data: null,
      error: { message: "deadlock detected", code: "40P01" },
    });
    const err = await completeHandover(TOKEN).catch((e: Error) => e);
    expect((err as Error).message).toBe(
      "Something went wrong and nothing was changed. Please try again.",
    );
    expect((err as Error).message).not.toMatch(/deadlock/);
    expect(h.updates).toHaveLength(2);
    expect(h.updates[1]).toMatchObject({ email: PLACEHOLDER });
    expect(h.calls).toContain("rpc:release_managed_handover");
  });

  it("is already complete when only the sign-in link fails: the adult is told to use Forgot password, not shown an error", async () => {
    h.linkHash = null;
    h.linkError = { message: "rate limited" };
    const done = await completeHandover(TOKEN);
    expect(done).toEqual({ recoveryTokenHash: null, childUserId: "child" });
    expect(h.updates).toHaveLength(1);
    expect(h.reports).toHaveLength(1);
  });

  it("reports (but swallows) a failed put-back, leaving the handover pending so the same link can be retried", async () => {
    h.rpc.finish_managed_handover = () => ({
      data: { ok: false, code: "HANDOVER_FAILED" },
      error: null,
    });
    h.putBackError = { message: "auth service unavailable" };
    await expect(completeHandover(TOKEN)).rejects.toThrow(/nothing was changed/i);
    expect(h.reports).toHaveLength(1);
    expect(h.calls.slice(-2)).toEqual(["auth:update", "rpc:release_managed_handover"]);
  });
});

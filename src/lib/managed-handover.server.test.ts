/**
 * The adult's side of a handover (managed-handover.server.ts), with the service role and the auth Admin API mocked. What
 * matters here is the order of the steps and that every failure leaves the account managed and linked: the sign-in record
 * is put back, the claim is released, and the database is never asked to finish what the sign-in record does not show.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as string[],
  rpc: {} as Record<string, (args: Record<string, unknown>) => { data?: unknown; error?: unknown }>,
  user: null as {
    id: string;
    email: string;
    email_confirmed_at?: string;
    app_metadata: Record<string, unknown>;
  } | null,
  getError: null as unknown,
  updateError: null as unknown,
  putBackError: null as unknown,
  repairError: null as unknown,
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
          if (h.repairError && h.updates.length >= 1) return { data: null, error: h.repairError };
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

const {
  completeHandover,
  hashHandoverToken,
  lookupHandover,
  newHandoverToken,
  reconcileManagedRecord,
} = await import("./managed-handover.server");

const TOKEN = "t".repeat(64);
const PLACEHOLDER = "mabc@managed.invalid";

beforeEach(() => {
  h.calls.length = 0;
  h.updates.length = 0;
  h.reports.length = 0;
  h.updateError = null;
  h.putBackError = null;
  h.repairError = null;
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
    // The default truth: the account is still managed by the guardian and nobody else is finishing it.
    managed_handover_state: () => ({
      data: { managed: true, managed_by: "guardian", pending: true, claim_live: false },
      error: null,
    }),
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

const GONE = {
  data: { managed: false, managed_by: null, pending: false, claim_live: false },
  error: null,
};
const REFUSED = { data: { ok: false, code: "HANDOVER_FAILED" }, error: null };

describe("completeHandover", () => {
  it("claims, puts the adult's confirmed address on the sign-in record with a throwaway password, finishes, then makes a sign-in link, in that order", async () => {
    const done = await completeHandover(TOKEN);
    expect(done).toEqual({ recoveryTokenHash: "recovery-hash", childUserId: "child" });
    expect(h.calls).toEqual([
      "rpc:claim_managed_handover",
      "auth:get",
      "auth:update",
      "rpc:finish_managed_handover",
      "auth:link",
    ]);
    expect(h.updates).toHaveLength(1);
    const { password, ...rest } = h.updates[0] as { password?: string } & Record<string, unknown>;
    expect(rest).toEqual({
      email: "adult@example.test",
      email_confirm: true,
      app_metadata: { managed: false, managed_by: null },
    });
    // A guardian who set a password while switched in does not keep it: it is replaced by one nobody ever sees.
    expect(password).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(done)).not.toContain(password as string);
  });

  it("uses a different throwaway password every time and never reports or returns it", async () => {
    await completeHandover(TOKEN);
    await completeHandover(TOKEN);
    const [a, b] = h.updates.map((u) => u.password);
    expect(a).not.toBe(b);
    expect(JSON.stringify(h.reports)).not.toContain(a as string);
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
      "the account is not managed and its address is not the adult's",
      { id: "child", email: "adult@example.test", app_metadata: {} },
    ],
    [
      "a real address is on the account but it is not the one the guardian gave",
      {
        id: "child",
        email: "other@example.test",
        email_confirmed_at: "2026-11-21T00:00:00Z",
        app_metadata: {},
      },
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
      "the sign-in record has a real address and is still marked managed",
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

  it("puts the sign-in record back when the database refuses to finish and the managed row is still there", async () => {
    h.rpc.finish_managed_handover = () => REFUSED;
    await expect(completeHandover(TOKEN)).rejects.toThrow(/nothing was changed/i);
    expect(h.updates).toHaveLength(2);
    expect(h.updates[1]).toEqual({
      email: PLACEHOLDER,
      email_confirm: true,
      app_metadata: { managed: true, managed_by: "guardian" },
    });
    expect(h.calls.slice(-3)).toEqual([
      "rpc:managed_handover_state",
      "auth:update",
      "rpc:release_managed_handover",
    ]);
    expect(h.calls).not.toContain("auth:link");
  });

  it("does the same when the database answered with an error of its own (it rolled back), and reports it", async () => {
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

  it("puts NOTHING back when the answer was lost (a transport error carries no database code): it may have committed", async () => {
    h.rpc.finish_managed_handover = () => ({
      data: null,
      error: { message: "TypeError: fetch failed", code: "" },
    });
    const err = await completeHandover(TOKEN).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/did not finish cleanly/i);
    expect((err as Error).message).not.toMatch(/fetch/);
    expect(h.updates).toHaveLength(1);
    expect(h.calls).not.toContain("rpc:release_managed_handover");
    expect(h.calls).not.toContain("auth:link");
    expect(h.reports).toHaveLength(1);
  });

  it("puts nothing back when the state cannot be read either", async () => {
    h.rpc.finish_managed_handover = () => REFUSED;
    h.rpc.managed_handover_state = () => ({
      data: null,
      error: { code: "PGRST202", message: "x" },
    });
    await expect(completeHandover(TOKEN)).rejects.toThrow(/did not finish cleanly/i);
    expect(h.updates).toHaveLength(1);
    expect(h.calls).not.toContain("rpc:release_managed_handover");
  });

  it("treats the handover as complete, and never puts the record back, when the answer was lost but the managed row is gone", async () => {
    // finish committed, then a database-coded error reached us (e.g. a gateway timeout surfaced as 57014 after the commit).
    h.rpc.finish_managed_handover = () => ({
      data: null,
      error: { message: "canceling statement", code: "57014" },
    });
    h.rpc.managed_handover_state = () => GONE;
    const done = await completeHandover(TOKEN);
    expect(done).toEqual({ recoveryTokenHash: "recovery-hash", childUserId: "child" });
    expect(h.updates).toHaveLength(1);
    expect(h.calls).not.toContain("rpc:release_managed_handover");
    expect(h.calls.at(-1)).toBe("auth:link");
  });

  it("treats HANDOVER_INVALID after another run completed it as complete, not as a failure to undo", async () => {
    // A run stalled past its claim; a second run claimed the same token and finished; the first run's finish now finds the token cleared.
    h.rpc.finish_managed_handover = () => ({
      data: { ok: false, code: "HANDOVER_INVALID" },
      error: null,
    });
    h.rpc.managed_handover_state = () => GONE;
    const done = await completeHandover(TOKEN);
    expect(done.childUserId).toBe("child");
    expect(h.updates).toHaveLength(1);
    expect(h.calls).not.toContain("rpc:release_managed_handover");
  });

  it("is already complete when only the sign-in link fails: the adult is told to use Forgot password, not shown an error", async () => {
    h.linkHash = null;
    h.linkError = { message: "rate limited" };
    const done = await completeHandover(TOKEN);
    expect(done).toEqual({ recoveryTokenHash: null, childUserId: "child" });
    expect(h.updates).toHaveLength(1);
    expect(h.reports).toHaveLength(1);
  });

  it("reports a failed put-back, still releases the claim, and leaves the record for the repair and the retry", async () => {
    h.rpc.finish_managed_handover = () => REFUSED;
    h.putBackError = { message: "auth service unavailable" };
    await expect(completeHandover(TOKEN)).rejects.toThrow(/nothing was changed/i);
    expect(h.reports).toHaveLength(1);
    expect(h.calls.slice(-2)).toEqual(["auth:update", "rpc:release_managed_handover"]);
  });

  it("the same link can be retried after a failed put-back: a record the earlier attempt left half done is continued from", async () => {
    // What a failed put-back (or a process that died after step 3) leaves: the adult's address, confirmed, not managed.
    h.user = {
      id: "child",
      email: "Adult@Example.test",
      email_confirmed_at: "2026-11-21T00:00:00Z",
      app_metadata: { managed: false },
    };
    const done = await completeHandover(TOKEN);
    expect(done).toEqual({ recoveryTokenHash: "recovery-hash", childUserId: "child" });
    expect(h.calls).toEqual([
      "rpc:claim_managed_handover",
      "auth:get",
      "auth:update",
      "rpc:finish_managed_handover",
      "auth:link",
    ]);
  });

  it("a retry that fails again puts back a FRESH placeholder (the old one is gone), never the adult's address", async () => {
    h.user = {
      id: "child",
      email: "adult@example.test",
      email_confirmed_at: "2026-11-21T00:00:00Z",
      app_metadata: {},
    };
    h.rpc.finish_managed_handover = () => REFUSED;
    await expect(completeHandover(TOKEN)).rejects.toThrow(/nothing was changed/i);
    const back = h.updates[1] as { email: string; app_metadata: unknown };
    expect(back.email).toMatch(/^m[0-9a-f]{32}@managed\.invalid$/);
    expect(back.app_metadata).toEqual({ managed: true, managed_by: "guardian" });
  });
});

describe("reconcileManagedRecord: the sign-in record follows the managed row", () => {
  const halfDone = {
    id: "child",
    email: "adult@example.test",
    email_confirmed_at: "2026-11-21T00:00:00Z",
    app_metadata: { managed: false },
  };

  it("puts a placeholder address and the managed flag back on a half-done record while the managed row exists and nobody is finishing", async () => {
    h.user = halfDone;
    expect(await reconcileManagedRecord("child")).toBe("repaired");
    expect(h.updates).toHaveLength(1);
    const u = h.updates[0] as { email: string; app_metadata: unknown };
    expect(u.email).toMatch(/^m[0-9a-f]{32}@managed\.invalid$/);
    expect(u).toMatchObject({
      email_confirm: true,
      app_metadata: { managed: true, managed_by: "guardian" },
    });
  });

  it("changes nothing when the record is already the managed placeholder of that guardian", async () => {
    expect(await reconcileManagedRecord("child")).toBe("ok");
    expect(h.updates).toEqual([]);
  });

  it("changes nothing while somebody is finishing a handover (a live claim)", async () => {
    h.user = halfDone;
    h.rpc.managed_handover_state = () => ({
      data: { managed: true, managed_by: "guardian", pending: true, claim_live: true },
      error: null,
    });
    expect(await reconcileManagedRecord("child")).toBe("busy");
    expect(h.updates).toEqual([]);
    expect(h.calls).not.toContain("auth:get");
  });

  it("changes nothing once the managed row is gone: a finished handover is never undone", async () => {
    h.user = halfDone;
    h.rpc.managed_handover_state = () => GONE;
    expect(await reconcileManagedRecord("child")).toBe("not_managed");
    expect(h.updates).toEqual([]);
  });

  it("looks at the state again right before writing, and stands down if a handover completed in between", async () => {
    h.user = halfDone;
    let n = 0;
    h.rpc.managed_handover_state = () =>
      ++n === 1
        ? {
            data: { managed: true, managed_by: "guardian", pending: false, claim_live: false },
            error: null,
          }
        : GONE;
    expect(await reconcileManagedRecord("child")).toBe("not_managed");
    expect(h.updates).toEqual([]);
  });

  it("changes nothing when the state cannot be read, and never throws", async () => {
    h.user = halfDone;
    h.rpc.managed_handover_state = () => ({
      data: null,
      error: { code: "PGRST202", message: "x" },
    });
    expect(await reconcileManagedRecord("child")).toBe("unknown");
    h.rpc.managed_handover_state = () => {
      throw new Error("boom");
    };
    expect(await reconcileManagedRecord("child")).toBe("unknown");
    expect(h.updates).toEqual([]);
  });

  it("reports a repair that failed and says so, without throwing", async () => {
    h.user = halfDone;
    h.repairError = { message: "auth unavailable" };
    expect(await reconcileManagedRecord("child")).toBe("unknown");
    expect(h.reports).toHaveLength(1);
  });
});

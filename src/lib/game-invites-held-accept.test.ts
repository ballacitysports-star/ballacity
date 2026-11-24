import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An accepted invitation held for the player's guardian (game_respond_invite answers on_roster false for a guarded
 * minor; 980 section 5, 20261130110000). The app asks the server to tell the guardian, once, after the final answer,
 * and the accept's words say the place waits for the parent. A paid game's accept (off the roster for everyone until
 * the payment) and a free game's (on the roster) keep their words.
 */
type RpcAnswer = { data: unknown; error: { message: string; code?: string } | null };
const env = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  first: [] as RpcAnswer[],
  answer: { data: null, error: null } as RpcAnswer,
  /** my_guardian_link_in_force */
  linked: { data: true as unknown, error: null as unknown },
  request: { data: null as unknown, error: null as unknown },
  requestReads: [] as string[],
  pings: [] as [string, unknown][],
  throwOnRead: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      env.calls.push({ fn, args });
      if (fn === "my_guardian_link_in_force") return env.linked;
      return env.first.shift() ?? env.answer;
    },
    from: (table: string) => {
      if (env.throwOnRead) throw new Error("offline");
      const q = {
        select: () => q,
        eq: (col: string, v: string) => {
          if (table === "join_requests" && col === "id") env.requestReads.push(v);
          return q;
        },
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => env.request,
      };
      return q;
    },
  },
}));
vi.mock("@/lib/guardian-push.functions", () => ({
  pingGuardians: (kind: string, id: unknown) => {
    env.pings.push([kind, id]);
  },
}));

const lib = await import("./game-invites");
const copy = await import("./invite-accept-copy");

/**
 * The ping is fire-and-forget (a dynamic import). A test that expects one waits for it (vi.waitFor); a test that expects
 * none lets pending work run after the mocked module was loaded once (beforeAll), so a ping would have landed by then.
 */
const settle = () => new Promise((r) => setTimeout(r, 0));
const pinged = (expected: [string, unknown][]) =>
  vi.waitFor(() => expect(env.pings).toEqual(expected));

beforeAll(async () => {
  await import("@/lib/guardian-push.functions");
});
const deadlock: RpcAnswer = { data: null, error: { code: "40P01", message: "deadlock detected" } };

beforeEach(() => {
  env.calls = [];
  env.first = [];
  env.answer = { data: null, error: null };
  env.linked = { data: true, error: null };
  env.request = { data: null, error: null };
  env.requestReads = [];
  env.pings = [];
  env.throwOnRead = false;
});

describe("respondToGameInvite tells the guardian about an accept off the roster", () => {
  it("asks the server once for an accept the player is not on the roster for", async () => {
    env.answer = {
      data: { status: "accepted", join_request_id: "jr", on_roster: false },
      error: null,
    };
    await lib.respondToGameInvite("inv", true);
    await pinged([["invite_accept", "inv"]]);
  });

  it("asks once after a deadlock and its retry, not once per try", async () => {
    env.first = [deadlock];
    env.answer = {
      data: { status: "accepted", join_request_id: "jr", on_roster: false },
      error: null,
    };
    await lib.respondToGameInvite("inv", true);
    expect(env.calls.filter((c) => c.fn === "game_respond_invite")).toHaveLength(2);
    await pinged([["invite_accept", "inv"]]);
    await settle();
    expect(env.pings).toEqual([["invite_accept", "inv"]]);
  });

  it("an answer from an older function without on_roster still asks (the server decides)", async () => {
    env.answer = { data: { status: "accepted", join_request_id: "jr" }, error: null };
    await lib.respondToGameInvite("inv", true);
    await pinged([["invite_accept", "inv"]]);
  });

  it("does not ask when the player is on the roster, declined, or the accept did not go through", async () => {
    for (const [data, accept] of [
      [{ status: "accepted", join_request_id: "jr", on_roster: true }, true],
      [{ status: "declined", on_roster: false }, false],
      [{ status: "full", on_roster: false }, true],
      [{ status: "expired", on_roster: false }, true],
      [{ status: "cancelled", on_roster: false }, true],
    ] as const) {
      env.answer = { data, error: null };
      await lib.respondToGameInvite("inv", accept);
    }
    await settle();
    expect(env.pings).toEqual([]);
  });

  it("does not ask when the answer failed", async () => {
    env.answer = { data: null, error: { message: "INVITE_NOT_FOUND" } };
    await expect(lib.respondToGameInvite("inv", true)).rejects.toThrow("INVITE_NOT_FOUND");
    await settle();
    expect(env.pings).toEqual([]);
  });
});

describe("acceptWaitsForGuardian", () => {
  const offRoster = { status: "accepted", join_request_id: "jr", on_roster: false } as const;

  it("is true for a guarded player whose request has no guardian approval (the game page's own rule)", async () => {
    env.request = { data: { status: "approved", guardian_approved_at: null }, error: null };
    await expect(lib.acceptWaitsForGuardian(offRoster, "kid")).resolves.toBe(true);
    expect(env.requestReads).toEqual(["jr"]);
  });

  it("is false on a paid game the guardian already approved (pay next), and for a player with no guardian in force", async () => {
    env.request = {
      data: { status: "approved", guardian_approved_at: "2026-11-20T00:00:00Z" },
      error: null,
    };
    await expect(lib.acceptWaitsForGuardian(offRoster, "kid")).resolves.toBe(false);
    env.request = { data: { status: "approved", guardian_approved_at: null }, error: null };
    env.linked = { data: false, error: null };
    await expect(lib.acceptWaitsForGuardian(offRoster, "adult")).resolves.toBe(false);
  });

  it("is false without reading anything for a seated player, another answer, or no request", async () => {
    for (const res of [
      { status: "accepted", join_request_id: "jr", on_roster: true },
      { status: "declined", on_roster: false },
      { status: "full", on_roster: false },
      { status: "accepted", on_roster: false },
    ] as const) {
      await expect(lib.acceptWaitsForGuardian(res, "kid")).resolves.toBe(false);
    }
    await expect(lib.acceptWaitsForGuardian(offRoster, null)).resolves.toBe(false);
    expect(env.requestReads).toEqual([]);
  });

  it("never throws: a failed read keeps the usual words", async () => {
    env.request = { data: null, error: { message: "boom" } };
    await expect(lib.acceptWaitsForGuardian(offRoster, "kid")).resolves.toBe(false);
    env.throwOnRead = true;
    await expect(lib.acceptWaitsForGuardian(offRoster, "kid")).resolves.toBe(false);
  });
});

describe("inviteAcceptedMessage", () => {
  it("a place held for the guardian says it waits for the parent, on the banner and on the Players tab", () => {
    for (const where of ["banner", "list"] as const) {
      const words = copy.inviteAcceptedMessage(
        { on_roster: false },
        { waitsForGuardian: true, where },
      );
      expect(words).toBe(copy.ACCEPT_HELD_FOR_PARENT);
      expect(words).toMatch(/parent has to approve/);
      expect(words).not.toMatch(/You're in\./);
      expect(words).not.toMatch(/host has been told/);
      // The toast cannot know the guardian was told (a best-effort ping; nobody is told with notifications off).
      expect(words).not.toMatch(/let them know|told/i);
    }
  });

  it("keeps the banner's words for a free game and a paid one", () => {
    for (const on_roster of [true, false]) {
      expect(
        copy.inviteAcceptedMessage({ on_roster }, { waitsForGuardian: false, where: "banner" }),
      ).toBe("You're in. The host has been told.");
    }
  });

  it("keeps the Players tab's words for a free game (on the roster) and a paid one (pay on the game page)", () => {
    expect(
      copy.inviteAcceptedMessage({ on_roster: true }, { waitsForGuardian: false, where: "list" }),
    ).toBe("You're in.");
    expect(
      copy.inviteAcceptedMessage({ on_roster: false }, { waitsForGuardian: false, where: "list" }),
    ).toBe("You're in. Open the game to finish joining.");
  });
});

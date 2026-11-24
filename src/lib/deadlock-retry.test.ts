import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An invitation answer (game_respond_invite) and a guardian's cancel for their child (guardian_cancel_child_game) each
 * run as one transaction, and each can deadlock (40P01): the answer with a host's decline, the payment-hold sweep or a
 * guardian's cancel; the cancel with a host's removal or the child's answer. Postgres then ends one side whole and keeps
 * nothing of it. Like hostRemoveParticipant, both try an ended call once more: a deadlock then success goes on, a second
 * deadlock reaches the screen in plain words, and any other error is not repeated.
 */
type RpcAnswer = { data: unknown; error: { message: string; code?: string } | null };
const { env, rpc } = vi.hoisted(() => {
  const env = {
    calls: [] as { fn: string; args: Record<string, unknown> }[],
    /** Answers for the first calls, in order; `result` after them. */
    first: [] as RpcAnswer[],
    result: { data: null, error: null } as RpcAnswer,
  };
  /** Both the browser client (respondToGameInvite) and the server function's client (cancelChildGame). */
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    env.calls.push({ fn, args });
    return env.first.shift() ?? env.result;
  };
  return { env, rpc };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
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
// The guardian notice an accept off the roster asks for (game-invites-held-accept.test.ts covers it with a retry).
vi.mock("@/lib/guardian-push.functions", () => ({ pingGuardians: () => {} }));

import { gameInviteErrorMessage, respondToGameInvite } from "./game-invites";
import { cancelChildGame } from "./guardian-activity.functions";
import { userErrorMessage } from "./user-error";

const deadlock: RpcAnswer = { data: null, error: { code: "40P01", message: "deadlock detected" } };
const child = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  env.calls.length = 0;
  env.first = [];
  env.result = { data: null, error: null };
});

describe("respondToGameInvite on a deadlock", () => {
  const answers = () => env.calls.filter((c) => c.fn === "game_respond_invite");

  it("a deadlock (a host's decline or a guardian's cancel at the same moment) is retried once, then the answer goes on", async () => {
    env.first = [deadlock];
    env.result = {
      data: { status: "accepted", join_request_id: "jr", on_roster: true },
      error: null,
    };
    await expect(respondToGameInvite("inv", true)).resolves.toEqual({
      status: "accepted",
      join_request_id: "jr",
      on_roster: true,
    });
    expect(answers()).toEqual([
      { fn: "game_respond_invite", args: { _invite: "inv", _accept: true } },
      { fn: "game_respond_invite", args: { _invite: "inv", _accept: true } },
    ]);
  });

  it("the retry reads what the other side did (a host's decline that won answers cancelled)", async () => {
    env.first = [deadlock];
    env.result = { data: { status: "cancelled", on_roster: false }, error: null };
    await expect(respondToGameInvite("inv", true)).resolves.toEqual({
      status: "cancelled",
      on_roster: false,
    });
    expect(answers()).toHaveLength(2);
  });

  it("a second deadlock is thrown as before, in plain words", async () => {
    env.first = [deadlock];
    env.result = deadlock;
    const err = await respondToGameInvite("inv", false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("deadlock detected");
    expect(answers()).toHaveLength(2);
    const words = gameInviteErrorMessage(err);
    expect(words).toBe("Something went wrong. Please try again.");
    expect(words).not.toMatch(/deadlock/i);
  });

  it("any other error is not retried and reads as before", async () => {
    env.result = { data: null, error: { code: "P0001", message: "INVITE_NOT_FOUND" } };
    await expect(respondToGameInvite("inv", true)).rejects.toThrow("INVITE_NOT_FOUND");
    expect(answers()).toHaveLength(1);
  });

  it("an error without a code is not retried either", async () => {
    env.result = { data: null, error: { message: "deadlock detected" } };
    await expect(respondToGameInvite("inv", true)).rejects.toThrow("deadlock detected");
    expect(answers()).toHaveLength(1);
  });
});

describe("cancelChildGame on a deadlock", () => {
  const context = { supabase: { rpc } };
  const run = () =>
    cancelChildGame({ data: { childUserId: child, gameId: "g1" }, context } as never);
  const cancels = () => env.calls.filter((c) => c.fn === "guardian_cancel_child_game");

  it("a deadlock (a host's removal or the child's accept at the same moment) is retried once, then the cancel goes on", async () => {
    env.first = [deadlock];
    env.result = { data: "withdrawn", error: null };
    await expect(run()).resolves.toEqual({ ok: true });
    expect(cancels()).toEqual([
      { fn: "guardian_cancel_child_game", args: { _child: child, _game: "g1" } },
      { fn: "guardian_cancel_child_game", args: { _child: child, _game: "g1" } },
    ]);
  });

  it("a second deadlock answers not ok, and the guardian sees the screen's own words", async () => {
    env.first = [deadlock];
    env.result = deadlock;
    const r = await run();
    expect(r).toEqual({ ok: false, error: "deadlock detected" });
    expect(cancels()).toHaveLength(2);
    // ChildrenActivitySection throws new Error(r.error) and shows userErrorMessage with its fallback.
    const fallback = "Couldn't cancel your child's spot. Please try again.";
    const words = userErrorMessage(new Error((r as { error: string }).error), fallback);
    expect(words).toBe(fallback);
    expect(words).not.toMatch(/deadlock/i);
  });

  it("a refusal is not retried and reaches the guardian as before", async () => {
    env.result = {
      data: null,
      error: { code: "42501", message: "You can only cancel for a child linked to your account." },
    };
    await expect(run()).resolves.toEqual({
      ok: false,
      error: "You can only cancel for a child linked to your account.",
    });
    expect(cancels()).toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A host's Remove and Decline also end the player's invitation to that game if they have not answered it yet, through
 * the host's own game_cancel_invite (20261119100000), best-effort like the rest of that cleanup: a failure there never
 * undoes or fails what the host did. A decline never turns an approved request (the player accepted the host's invitation
 * meanwhile) into a declined one; the roster's Remove still does, on purpose.
 */
type Step = { table: string; op: string; payload?: unknown; filters: unknown[][] };
const env = vi.hoisted(() => ({
  steps: [] as Step[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  pendingInvites: [] as { id: string }[],
  failOn: new Map<string, { message: string; code?: string }>(),
  rpcError: null as { message: string } | null,
  request: { game_id: "g1", player_id: "p1" } as { game_id: string; player_id: string } | null,
  status: "pending" as string,
}));

function builder(table: string) {
  const step: Step = { table, op: "", filters: [] };
  const result = () => {
    const error = env.failOn.get(`${table}.${step.op}`) ?? null;
    if (error) return { data: null, error };
    if (table === "game_invites" && step.op === "select")
      return { data: env.pendingInvites, error: null };
    if (table === "join_requests" && step.op === "update") {
      // The row the update reaches: none when it is gone, or approved under a "not approved" filter.
      const skipsApproved = step.filters.some(
        ([op, col, v]) => op === "neq" && col === "status" && v === "approved",
      );
      const hit = env.request && !(skipsApproved && env.status === "approved");
      return { data: hit ? [{ id: "jr1" }] : [], error: null };
    }
    return { data: null, error: null };
  };
  const b = {
    select(cols: string) {
      if (!step.op) {
        step.op = "select";
        step.payload = cols;
        env.steps.push(step);
      }
      return b;
    },
    update(payload: unknown) {
      step.op = "update";
      step.payload = payload;
      env.steps.push(step);
      return b;
    },
    delete() {
      step.op = "delete";
      env.steps.push(step);
      return b;
    },
    eq(col: string, v: unknown) {
      step.filters.push(["eq", col, v]);
      return b;
    },
    neq(col: string, v: unknown) {
      step.filters.push(["neq", col, v]);
      return b;
    },
    async maybeSingle() {
      const error = env.failOn.get(`${table}.${step.op}`) ?? null;
      if (error) return { data: null, error };
      return {
        data:
          table === "join_requests" && env.request ? { ...env.request, status: env.status } : null,
        error: null,
      };
    },
    then<T>(ok: (v: ReturnType<typeof result>) => T, ko?: (e: unknown) => T) {
      return Promise.resolve(result()).then(ok, ko);
    },
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      env.rpcs.push({ fn, args });
      return env.rpcError
        ? { data: null, error: env.rpcError }
        : { data: "cancelled", error: null };
    },
  },
}));

import { hostRemoveParticipant, reviewJoinRequest } from "./payments";
import { FEATURE_ERROR_MESSAGES, userErrorMessage } from "./user-error";

beforeEach(() => {
  env.steps.length = 0;
  env.rpcs.length = 0;
  env.pendingInvites = [{ id: "inv1" }];
  env.failOn.clear();
  env.rpcError = null;
  env.request = { game_id: "g1", player_id: "p1" };
  env.status = "pending";
});

const inviteLookup = () => env.steps.find((s) => s.table === "game_invites");

describe("hostRemoveParticipant", () => {
  it("ends the removed player's pending invitation to that game after the removal", async () => {
    await hostRemoveParticipant({ gameId: "g1", playerId: "p1" });
    expect(env.steps.map((s) => `${s.table}.${s.op}`)).toEqual([
      "game_participants.delete",
      "join_requests.delete",
      "payment_submissions.delete",
      "game_invites.select",
    ]);
    expect(inviteLookup()!.filters).toEqual([
      ["eq", "game_id", "g1"],
      ["eq", "invitee_id", "p1"],
      ["eq", "status", "pending"],
    ]);
    expect(env.rpcs).toEqual([{ fn: "game_cancel_invite", args: { _invite: "inv1" } }]);
  });

  it("cancels nothing when no invitation is waiting", async () => {
    env.pendingInvites = [];
    await hostRemoveParticipant({ gameId: "g1", playerId: "p1" });
    expect(env.rpcs).toEqual([]);
  });

  it("still succeeds when ending the invitation fails", async () => {
    env.rpcError = { message: "INVITE_NOT_FOUND" };
    await expect(hostRemoveParticipant({ gameId: "g1", playerId: "p1" })).resolves.toBeUndefined();
    env.failOn.set("game_invites.select", { message: "permission denied" });
    await expect(hostRemoveParticipant({ gameId: "g1", playerId: "p1" })).resolves.toBeUndefined();
  });

  it("touches no invitation when the removal itself fails", async () => {
    env.failOn.set("game_participants.delete", { message: "nope", code: "42501" });
    await expect(hostRemoveParticipant({ gameId: "g1", playerId: "p1" })).rejects.toMatchObject({
      message: "nope",
    });
    expect(inviteLookup()).toBeUndefined();
    expect(env.rpcs).toEqual([]);
  });
});

describe("reviewJoinRequest", () => {
  it("a decline ends the player's pending invitation to the request's game", async () => {
    await reviewJoinRequest("jr1", "rejected", "Not this time");
    expect(env.steps.map((s) => `${s.table}.${s.op}`)).toEqual([
      "join_requests.update",
      "join_requests.select",
      "game_invites.select",
    ]);
    expect(env.steps[0]!.filters).toEqual([
      ["eq", "id", "jr1"],
      ["neq", "status", "approved"],
    ]);
    expect(env.steps[1]!.filters).toEqual([["eq", "id", "jr1"]]);
    expect(inviteLookup()!.filters).toEqual([
      ["eq", "game_id", "g1"],
      ["eq", "invitee_id", "p1"],
      ["eq", "status", "pending"],
    ]);
    expect(env.rpcs).toEqual([{ fn: "game_cancel_invite", args: { _invite: "inv1" } }]);
  });

  it("a decline that reaches an approved request (the player accepted meanwhile) changes nothing and says so", async () => {
    env.status = "approved";
    const err = await reviewJoinRequest("jr1", "rejected", "Not this time").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(FEATURE_ERROR_MESSAGES.declineAlreadyApproved);
    // The hosts' screens show it as it is, not a "try again".
    expect(userErrorMessage(err, "Couldn't update this request. Please try again.")).toBe(
      FEATURE_ERROR_MESSAGES.declineAlreadyApproved,
    );
    expect(env.steps.map((s) => `${s.table}.${s.op}`)).toEqual([
      "join_requests.update",
      "join_requests.select",
    ]);
    expect(env.rpcs).toEqual([]);
  });

  it("a decline of a request that is gone resolves as before", async () => {
    env.request = null;
    await expect(reviewJoinRequest("jr1", "rejected")).resolves.toBeUndefined();
  });

  it("the roster's Remove still declines an approved request, and ends the invitation", async () => {
    env.status = "approved";
    await expect(
      reviewJoinRequest("jr1", "rejected", "Removed by host", { removing: true }),
    ).resolves.toBeUndefined();
    expect(env.steps[0]!.filters).toEqual([["eq", "id", "jr1"]]);
    expect(env.rpcs).toEqual([{ fn: "game_cancel_invite", args: { _invite: "inv1" } }]);
  });

  it("an approval leaves invitations alone", async () => {
    await reviewJoinRequest("jr1", "approved");
    expect(env.steps.map((s) => `${s.table}.${s.op}`)).toEqual(["join_requests.update"]);
    expect(env.steps[0]!.filters).toEqual([["eq", "id", "jr1"]]);
    expect(env.rpcs).toEqual([]);
  });

  it("a decline that fails ends nothing and reports the failure", async () => {
    env.failOn.set("join_requests.update", { message: "denied", code: "42501" });
    await expect(reviewJoinRequest("jr1", "rejected")).rejects.toMatchObject({ message: "denied" });
    expect(env.rpcs).toEqual([]);
  });

  it("a decline still succeeds when ending the invitation fails", async () => {
    env.rpcError = { message: "INVITE_NOT_FOUND" };
    await expect(reviewJoinRequest("jr1", "rejected")).resolves.toBeUndefined();
    env.failOn.set("join_requests.select", { message: "nope" });
    await expect(reviewJoinRequest("jr1", "rejected")).resolves.toBeUndefined();
    env.request = null;
    await expect(reviewJoinRequest("jr1", "rejected")).resolves.toBeUndefined();
  });
});

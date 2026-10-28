/* eslint-disable @typescript-eslint/no-explicit-any -- an in-memory Supabase stub */
import { describe, expect, it } from "vitest";
import { guardianNeedsForGame } from "./join-guardian.server";
import { hostBadge, joinWait, playerWaitCopy } from "./join-guardian-status";

function fakeAdmin(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
        in: (k: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[k]))), q),
        maybeSingle: async () => ({ data: rows[0] ?? null }),
        then: (res: (v: unknown) => unknown) => res({ data: rows }),
      };
      return q;
    },
  };
}

const world = () => ({
  hosted_games: [{ id: "g1", host_id: "host" }],
  join_requests: [
    { id: "r-kid", game_id: "g1", player_id: "kid", status: "pending", guardian_approved_at: null },
    {
      id: "r-teen",
      game_id: "g1",
      player_id: "teen",
      status: "approved",
      guardian_approved_at: "2026-10-28",
    },
    {
      id: "r-adult",
      game_id: "g1",
      player_id: "adult",
      status: "pending",
      guardian_approved_at: null,
    },
    {
      id: "r-no",
      game_id: "g1",
      player_id: "kid2",
      status: "rejected",
      guardian_approved_at: null,
    },
  ],
  guardian_links: [
    { child_user_id: "kid", status: "active" },
    { child_user_id: "teen", status: "active" },
    { child_user_id: "kid2", status: "active" },
    { child_user_id: "adult", status: "revoked" },
  ],
});

describe("guardianNeedsForGame", () => {
  it("tells the host which requests need a parent, and which parents have approved", async () => {
    const out = await guardianNeedsForGame(fakeAdmin(world()) as any, {
      gameId: "g1",
      callerId: "host",
    });
    expect(out).toEqual([
      { requestId: "r-kid", needsGuardian: true, guardianApproved: false },
      { requestId: "r-teen", needsGuardian: true, guardianApproved: true },
      { requestId: "r-adult", needsGuardian: false, guardianApproved: false },
    ]);
  });

  it("refuses anyone who is not the game's host", async () => {
    await expect(
      guardianNeedsForGame(fakeAdmin(world()) as any, { gameId: "g1", callerId: "kid" }),
    ).rejects.toThrow("Only the host");
    await expect(
      guardianNeedsForGame(fakeAdmin(world()) as any, { gameId: "nope", callerId: "host" }),
    ).rejects.toThrow("Only the host");
  });
});

describe("join status wording", () => {
  it("has nothing to add for someone with no guardian, or a declined request", () => {
    expect(
      joinWait({ hostStatus: "pending", needsGuardian: false, guardianApproved: false }),
    ).toBeNull();
    expect(
      joinWait({ hostStatus: "rejected", needsGuardian: true, guardianApproved: false }),
    ).toBeNull();
    expect(
      joinWait({ hostStatus: "pending", needsGuardian: true, guardianApproved: true }),
    ).toBeNull();
  });

  it("says who is still to answer", () => {
    const both = joinWait({ hostStatus: "pending", needsGuardian: true, guardianApproved: false })!;
    expect(both).toEqual({ onParent: true, onHost: true });
    expect(playerWaitCopy(both).title).toMatch(/parent and the host/i);
    const parentOnly = joinWait({
      hostStatus: "approved",
      needsGuardian: true,
      guardianApproved: false,
    })!;
    expect(parentOnly).toEqual({ onParent: true, onHost: false });
    expect(playerWaitCopy(parentOnly).title).toMatch(/waiting for your parent/i);
  });

  it("badges a minor's request for the host", () => {
    expect(hostBadge({ needsGuardian: true, guardianApproved: false })).toEqual({
      label: "Needs parent OK",
      tone: "warn",
    });
    expect(hostBadge({ needsGuardian: true, guardianApproved: true })).toEqual({
      label: "Parent approved",
      tone: "ok",
    });
    expect(hostBadge({ needsGuardian: false, guardianApproved: false })).toBeNull();
  });
});

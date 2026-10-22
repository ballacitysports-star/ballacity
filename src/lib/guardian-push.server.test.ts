/* eslint-disable @typescript-eslint/no-explicit-any -- a hand-rolled in-memory Supabase stub */
import { describe, expect, it, vi } from "vitest";
import {
  DEDUPE_WINDOW_MS,
  GUARDIAN_APPROVAL_LINK,
  GUARDIAN_APPROVAL_TYPE,
  planGuardianApprovalPush,
  sendGuardianApprovalPush,
} from "./guardian-push.server";

type Rows = Record<string, any[]>;

/** Just enough of the query builder: select, eq chains, gte, limit, maybeSingle, insert. */
function fakeAdmin(tables: Rows) {
  const inserted: { table: string; row: any }[] = [];
  const admin = {
    inserted,
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
        gte: (k: string, v: string) => ((rows = rows.filter((r) => String(r[k]) >= v)), q),
        limit: (n: number) => ((rows = rows.slice(0, n)), q),
        maybeSingle: async () => ({ data: rows[0] ?? null }),
        insert: async (row: any) => {
          inserted.push({ table, row });
          (tables[table] ??= []).push({ ...row, created_at: new Date().toISOString() });
          return { error: null };
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows }),
      };
      return q;
    },
  };
  return admin;
}

const world = (over: Partial<Rows> = {}): Rows => ({
  join_requests: [
    { id: "jr1", player_id: "kid", game_id: "g1", status: "pending", guardian_approved_at: null },
  ],
  hosted_games: [{ id: "g1", title: "Sunday 14U scrimmage" }],
  team_invites: [
    {
      id: "inv1",
      invitee_id: "kid",
      invited_by: "coach",
      team_id: "t1",
      status: "pending",
      guardian_approved_at: null,
    },
  ],
  teams: [{ id: "t1", name: "Atlanta 14U" }],
  guardian_links: [
    { parent_user_id: "mom", child_user_id: "kid", status: "active" },
    { parent_user_id: "dad", child_user_id: "kid", status: "active" },
    { parent_user_id: "old", child_user_id: "kid", status: "revoked" },
  ],
  profiles: [{ id: "kid", display_name: "Nathaniel" }],
  child_controls: [{ child_user_id: "kid", notifications: true }],
  notifications: [],
  ...over,
});

describe("planGuardianApprovalPush", () => {
  it("tells every active guardian that the child's join request is waiting", async () => {
    const plan = await planGuardianApprovalPush(fakeAdmin(world()) as any, {
      kind: "join_request",
      id: "jr1",
      callerId: "kid",
    });
    expect(plan.messages.map((m) => m.userId).sort()).toEqual(["dad", "mom"]);
    expect(plan.messages[0]).toMatchObject({
      title: "Approval needed",
      body: "Nathaniel asked to join Sunday 14U scrimmage. Review it in the Parent Center.",
      url: GUARDIAN_APPROVAL_LINK,
    });
    expect(plan.writeNotification).toBe(true);
  });

  it("tells them about a team invite, where the database already wrote the in-app note", async () => {
    const plan = await planGuardianApprovalPush(fakeAdmin(world()) as any, {
      kind: "team_invite",
      id: "inv1",
      callerId: "coach",
    });
    expect(plan.messages[0]!.body).toBe(
      "Nathaniel was invited to join Atlanta 14U. Review it in the Parent Center.",
    );
    expect(plan.writeNotification).toBe(false);
  });

  it("only the child who asked can raise it, and only the inviter an invite", async () => {
    const admin = fakeAdmin(world()) as any;
    for (const [kind, id, callerId] of [
      ["join_request", "jr1", "stranger"],
      ["join_request", "jr1", "mom"],
      ["team_invite", "inv1", "kid"],
      ["team_invite", "inv1", "stranger"],
    ] as const) {
      const plan = await planGuardianApprovalPush(admin, { kind, id, callerId });
      expect(plan.messages).toEqual([]);
    }
  });

  it("says nothing once it is answered or has been approved", async () => {
    for (const patch of [
      { status: "approved" },
      { guardian_approved_at: "2026-10-22T00:00:00Z" },
    ]) {
      const w = world();
      Object.assign(w.join_requests![0], patch);
      const plan = await planGuardianApprovalPush(fakeAdmin(w) as any, {
        kind: "join_request",
        id: "jr1",
        callerId: "kid",
      });
      expect(plan.messages).toEqual([]);
    }
  });

  it("says nothing when the guardian turned the child's notifications off, or there is no guardian", async () => {
    const off = world({ child_controls: [{ child_user_id: "kid", notifications: false }] });
    expect(
      (
        await planGuardianApprovalPush(fakeAdmin(off) as any, {
          kind: "join_request",
          id: "jr1",
          callerId: "kid",
        })
      ).messages,
    ).toEqual([]);
    const none = world({ guardian_links: [] });
    expect(
      (
        await planGuardianApprovalPush(fakeAdmin(none) as any, {
          kind: "join_request",
          id: "jr1",
          callerId: "kid",
        })
      ).messages,
    ).toEqual([]);
  });

  it("falls back to plain words when a name or title is missing", async () => {
    const w = world({ profiles: [], hosted_games: [] });
    const plan = await planGuardianApprovalPush(fakeAdmin(w) as any, {
      kind: "join_request",
      id: "jr1",
      callerId: "kid",
    });
    expect(plan.messages[0]!.body).toBe(
      "Your child asked to join a game. Review it in the Parent Center.",
    );
  });

  it("never names the guardians to the caller: the plan holds only what is sent to them", async () => {
    const plan = await planGuardianApprovalPush(fakeAdmin(world()) as any, {
      kind: "join_request",
      id: "jr1",
      callerId: "kid",
    });
    expect(Object.keys(plan).sort()).toEqual(["messages", "writeNotification"]);
  });
});

describe("sendGuardianApprovalPush", () => {
  const msgs = [
    { userId: "mom", title: "Approval needed", body: "B", url: "/parent" },
    { userId: "dad", title: "Approval needed", body: "B", url: "/parent" },
  ];

  it("records a notification for each guardian, then pushes", async () => {
    const admin = fakeAdmin({ notifications: [] }) as any;
    const push = vi.fn(async () => ({ ok: true }));
    const told = await sendGuardianApprovalPush(
      admin,
      { writeNotification: true, messages: msgs },
      { push },
    );
    expect(told).toBe(2);
    expect(push).toHaveBeenCalledTimes(2);
    expect(admin.inserted.map((i: any) => i.row.type)).toEqual([
      GUARDIAN_APPROVAL_TYPE,
      GUARDIAN_APPROVAL_TYPE,
    ]);
  });

  it("skips a guardian who already got the same message in the last hour", async () => {
    const admin = fakeAdmin({ notifications: [] }) as any;
    const push = vi.fn(async () => ({ ok: true }));
    const plan = { writeNotification: true, messages: msgs };
    await sendGuardianApprovalPush(admin, plan, { push });
    push.mockClear();
    expect(await sendGuardianApprovalPush(admin, plan, { push })).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });

  it("tells them again after the window", async () => {
    const admin = fakeAdmin({ notifications: [] }) as any;
    const push = vi.fn(async () => ({ ok: true }));
    const plan = { writeNotification: true, messages: msgs.slice(0, 1) };
    await sendGuardianApprovalPush(admin, plan, { push });
    const later = () => Date.now() + DEDUPE_WINDOW_MS * 2;
    // The stored row's timestamp is "now"; a window ending after it no longer covers it.
    expect(await sendGuardianApprovalPush(admin, plan, { push, now: later })).toBe(1);
  });

  it("writes no notification row for a team invite (the database wrote it) but still pushes", async () => {
    const admin = fakeAdmin({ notifications: [] }) as any;
    const push = vi.fn(async () => ({ ok: true }));
    await sendGuardianApprovalPush(admin, { writeNotification: false, messages: msgs }, { push });
    expect(admin.inserted).toEqual([]);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("a failed push does not stop the next guardian or lose the record", async () => {
    const admin = fakeAdmin({ notifications: [] }) as any;
    const push = vi.fn(async (m: { userId: string }) => {
      if (m.userId === "mom") throw new Error("provider down");
      return { ok: true };
    });
    const told = await sendGuardianApprovalPush(
      admin,
      { writeNotification: true, messages: msgs },
      { push },
    );
    expect(told).toBe(2);
    expect(admin.inserted).toHaveLength(2);
  });
});

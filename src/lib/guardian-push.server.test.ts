/* eslint-disable @typescript-eslint/no-explicit-any -- a hand-rolled in-memory Supabase stub */
import { describe, expect, it, vi } from "vitest";
import {
  DEDUPE_WINDOW_MS,
  openedAt,
  GUARDIAN_APPROVAL_LINK,
  GUARDIAN_APPROVAL_TYPE,
  guardianRequestLink,
  planGuardianApprovalPush,
  sendGuardianApprovalPush,
} from "./guardian-push.server";

type Rows = Record<string, any[]>;

/**
 * Just enough of the query builder: select, eq chains, in, gte, limit, maybeSingle, insert. `inForce` stands in for
 * public.guardian_links_in_force (the database rule: a link to someone who has turned 18 is not in force); without
 * it the stub has no such function and the server reads the active rows, as before the migration.
 */
function fakeAdmin(tables: Rows, inForce?: (children: string[]) => any[]) {
  const inserted: { table: string; row: any }[] = [];
  const admin = {
    inserted,
    ...(inForce
      ? { rpc: async (fn: string, args: any) => ({ data: inForce(args._children), error: null }) }
      : {}),
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
        in: (k: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[k]))), q),
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
      body: "Nathaniel requested a spot in Sunday 14U scrimmage. Review it in the Parent Center.",
      // The Parent Center, named by the request, so a later notice can tell this request from a same-titled game's.
      url: "/parent?request=jr1",
    });
    expect(plan.messages[0]!.url).toBe(guardianRequestLink("jr1"));
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
    expect(plan.messages[0]!.url).toBe(GUARDIAN_APPROVAL_LINK);
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

  it("says nothing about an invite held back because of a block (20261111120000)", async () => {
    const plan = await planGuardianApprovalPush(
      fakeAdmin(world({ team_invite_suppressions: [{ invite_id: "inv1" }] })) as any,
      { kind: "team_invite", id: "inv1", callerId: "coach" },
    );
    expect(plan.messages).toEqual([]);
    // Any other invite is still raised with the guardians.
    const other = await planGuardianApprovalPush(
      fakeAdmin(world({ team_invite_suppressions: [{ invite_id: "inv-other" }] })) as any,
      { kind: "team_invite", id: "inv1", callerId: "coach" },
    );
    expect(other.messages).toHaveLength(2);
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

  it("does not tell a guardian whose child has turned 18, even while the link still says active", async () => {
    // The database rule (20261125200000) says only the guardian in force: dad's child is 18 now, mom's is not.
    const plan = await planGuardianApprovalPush(
      fakeAdmin(world(), (children) =>
        [{ parent_user_id: "mom", child_user_id: "kid", verified_at: "2026-10-01" }].filter((l) =>
          children.includes(l.child_user_id),
        ),
      ) as any,
      { kind: "join_request", id: "jr1", callerId: "kid" },
    );
    expect(plan.messages.map((m) => m.userId)).toEqual(["mom"]);
    const none = await planGuardianApprovalPush(fakeAdmin(world(), () => []) as any, {
      kind: "join_request",
      id: "jr1",
      callerId: "kid",
    });
    expect(none.messages).toEqual([]);
  });

  it("falls back to the active rows when the rule is not there (app ahead of the migration)", async () => {
    const admin = fakeAdmin(world()) as any;
    admin.rpc = async () => ({ data: null, error: { message: "function does not exist" } });
    const plan = await planGuardianApprovalPush(admin, {
      kind: "join_request",
      id: "jr1",
      callerId: "kid",
    });
    expect(plan.messages.map((m) => m.userId).sort()).toEqual(["dad", "mom"]);
  });

  it("falls back to plain words when a name or title is missing", async () => {
    const w = world({ profiles: [], hosted_games: [] });
    const plan = await planGuardianApprovalPush(fakeAdmin(w) as any, {
      kind: "join_request",
      id: "jr1",
      callerId: "kid",
    });
    expect(plan.messages[0]!.body).toBe(
      "Your child requested a spot in a game. Review it in the Parent Center.",
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

  it("a message about another request with the same words is not a duplicate (two games with the same title)", async () => {
    const admin = fakeAdmin({
      notifications: [
        {
          id: "n1",
          user_id: "mom",
          type: GUARDIAN_APPROVAL_TYPE,
          body: "B",
          link: guardianRequestLink("jr-other"),
          created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        },
      ],
    }) as any;
    const push = vi.fn(async () => ({ ok: true }));
    const plan = {
      writeNotification: true,
      messages: [{ ...msgs[0]!, url: guardianRequestLink("jr1") }],
    };
    expect(await sendGuardianApprovalPush(admin, plan, { push })).toBe(1);
    // The same request again inside the hour is the duplicate.
    expect(await sendGuardianApprovalPush(admin, plan, { push })).toBe(0);
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

  it("the same request named in another spelling (letter case, braces, no hyphens) is the same duplicate", async () => {
    // Postgres reads a uuid however it is spelt, so every spelling finds the child's own request; the stub does too.
    const id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const uuidKey = (v: unknown) => String(v).toLowerCase().replace(/[{}-]/g, "");
    const tables = world({
      join_requests: [{ ...world().join_requests![0], id }],
    });
    const base = fakeAdmin(tables) as any;
    const admin = {
      ...base,
      from(table: string) {
        const q = base.from(table);
        if (table !== "join_requests") return q;
        const eq = q.eq;
        q.eq = (k: string, v: unknown) =>
          eq(
            k,
            k === "id"
              ? (tables.join_requests!.find((r) => uuidKey(r.id) === uuidKey(v))?.id ?? v)
              : v,
          );
        return q;
      },
    };
    const push = vi.fn(async () => ({ ok: true }));
    const first = await planGuardianApprovalPush(admin, {
      kind: "join_request",
      id,
      callerId: "kid",
    });
    expect(await sendGuardianApprovalPush(admin, first, { push })).toBe(2);
    for (const spelling of [
      id.toUpperCase(),
      `{${id}}`,
      id.replace(/-/g, ""),
      `${id.slice(0, 9)}${id.slice(9).toUpperCase()}`,
    ]) {
      const again = await planGuardianApprovalPush(admin, {
        kind: "join_request",
        id: spelling,
        callerId: "kid",
      });
      // Still the child's own pending request, named by its stored id.
      expect(again.messages.map((m) => m.url)).toEqual([
        guardianRequestLink(id),
        guardianRequestLink(id),
      ]);
      expect(await sendGuardianApprovalPush(admin, again, { push })).toBe(0);
    }
    expect(push).toHaveBeenCalledTimes(2);
    expect(base.inserted).toHaveLength(2);
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

/**
 * An invitation the child accepted that is held for the guardian (game_respond_invite answered on_roster false: the
 * request is approved with no guardian approval and the child has no place; 980 section 5, 20261130110000). The guardian
 * is told as for a pending request, once per attempt of the request.
 */
describe("planGuardianApprovalPush: an accepted invitation held for the guardian", () => {
  const OPENED = "2026-11-20T10:00:00.000Z";
  const HELD_BODY =
    "Nathaniel accepted an invitation to Sunday 14U scrimmage. Review it in the Parent Center.";
  const PENDING_BODY =
    "Nathaniel requested a spot in Sunday 14U scrimmage. Review it in the Parent Center.";
  const held = (over: Partial<Rows> = {}): Rows =>
    world({
      game_invites: [
        {
          id: "gi1",
          invitee_id: "kid",
          game_id: "g1",
          status: "accepted",
          join_request_id: "jr9",
        },
      ],
      join_requests: [
        {
          id: "jr9",
          player_id: "kid",
          game_id: "g1",
          status: "approved",
          guardian_approved_at: null,
          created_at: OPENED,
          last_rejected_at: null,
        },
      ],
      game_participants: [],
      ...over,
    });
  const plan = (w: Rows, callerId = "kid", inForce?: (c: string[]) => any[]) =>
    planGuardianApprovalPush(fakeAdmin(w, inForce) as any, {
      kind: "invite_accept",
      id: "gi1",
      callerId,
    });
  const notice = (userId: string, body: string, created_at: string) => ({
    id: `n-${userId}-${created_at}`,
    user_id: userId,
    type: GUARDIAN_APPROVAL_TYPE,
    body,
    created_at,
  });

  it("tells every guardian in force, in the app and by push, with the Parent Center link", async () => {
    const p = await plan(held());
    expect(p.writeNotification).toBe(true);
    expect(p.messages.map((m) => m.userId).sort()).toEqual(["dad", "mom"]);
    expect(p.messages[0]).toEqual({
      userId: expect.any(String),
      title: "Approval needed",
      body: HELD_BODY,
      url: guardianRequestLink("jr9"),
    });
  });

  it("only the invitee who accepted can raise it", async () => {
    for (const caller of ["stranger", "mom", "host"]) {
      expect((await plan(held(), caller)).messages).toEqual([]);
    }
  });

  it("says nothing unless the invitation is accepted and names the child's own request for that game", async () => {
    const inv = (patch: Record<string, unknown>) =>
      held({ game_invites: [{ ...held().game_invites![0], ...patch }] });
    for (const w of [
      inv({ status: "pending" }),
      inv({ status: "declined" }),
      inv({ status: "expired" }),
      inv({ status: "cancelled" }),
      inv({ join_request_id: null }),
      inv({ join_request_id: "missing" }),
      inv({ game_id: "other-game" }),
      held({ game_invites: [] }),
    ]) {
      expect((await plan(w)).messages).toEqual([]);
    }
    // The request is someone else's.
    const other = held();
    other.join_requests![0].player_id = "someone";
    expect((await plan(other)).messages).toEqual([]);
  });

  it("says nothing when the place is not waiting for the guardian", async () => {
    const req = (patch: Record<string, unknown>) =>
      held({ join_requests: [{ ...held().join_requests![0], ...patch }] });
    for (const w of [
      // The guardian already approved it (a paid game's accept: the child pays next).
      req({ guardian_approved_at: "2026-11-21T00:00:00Z" }),
      // The accept left it declined (a guarded child already on the roster), or it is still pending.
      req({ status: "rejected" }),
      req({ status: "pending" }),
      // The child already has the place.
      held({ game_participants: [{ id: "gp1", game_id: "g1", user_id: "kid" }] }),
    ]) {
      expect((await plan(w)).messages).toEqual([]);
    }
  });

  it("tells nobody for an adult or a child with no guardian link in force, or with the child's notifications off", async () => {
    // An adult: the database rule leaves no link in force (an 18-year-old's old link that still says active).
    expect((await plan(held(), "kid", () => [])).messages).toEqual([]);
    // A minor nobody is linked to.
    expect((await plan(held({ guardian_links: [] }))).messages).toEqual([]);
    expect(
      (
        await plan(
          held({
            guardian_links: [{ parent_user_id: "mom", child_user_id: "kid", status: "revoked" }],
          }),
        )
      ).messages,
    ).toEqual([]);
    // The guardian switched the child's notifications off, as for a pending request.
    expect(
      (await plan(held({ child_controls: [{ child_user_id: "kid", notifications: false }] })))
        .messages,
    ).toEqual([]);
  });

  it("does not tell a guardian again who was told about the request while it waited (pending, or approved by the host)", async () => {
    // Mom got the pending request's notice after the request was sent; dad's predates it (another attempt).
    const w = held({
      notifications: [
        notice("mom", PENDING_BODY, "2026-11-20T10:05:00.000Z"),
        notice("dad", PENDING_BODY, "2026-11-19T09:00:00.000Z"),
      ],
    });
    expect((await plan(w)).messages.map((m) => m.userId)).toEqual(["dad"]);
    // Both told: nothing to send.
    w.notifications!.push(notice("dad", PENDING_BODY, "2026-11-20T11:00:00.000Z"));
    expect(await plan(w)).toEqual({ writeNotification: false, messages: [] });
  });

  it("tells the guardian again when the accept reopened a declined request (a new attempt)", async () => {
    // Told about the earlier attempt, then the host declined it; the accept reopened it with no guardian approval.
    const w = held({
      join_requests: [
        {
          ...held().join_requests![0],
          created_at: "2026-11-01T00:00:00.000Z",
          last_rejected_at: "2026-11-22T08:00:00.000Z",
        },
      ],
      notifications: [
        notice("mom", PENDING_BODY, "2026-11-05T00:00:00.000Z"),
        notice("dad", HELD_BODY, "2026-11-10T00:00:00.000Z"),
      ],
    });
    expect((await plan(w)).messages.map((m) => m.userId).sort()).toEqual(["dad", "mom"]);
  });

  it("an earlier notice about another game, or of another kind, does not count", async () => {
    const w = held({
      notifications: [
        notice(
          "mom",
          "Nathaniel requested a spot in Friday run. Review it in the Parent Center.",
          "2026-11-21T00:00:00.000Z",
        ),
        { ...notice("dad", HELD_BODY, "2026-11-21T00:00:00.000Z"), type: "game_invite" },
      ],
    });
    expect((await plan(w)).messages.map((m) => m.userId).sort()).toEqual(["dad", "mom"]);
  });

  it("matches a game title with commas, brackets and quotes as written", async () => {
    const title = 'Sunday "run", 5v5 (14U)';
    const body = `Nathaniel accepted an invitation to ${title}. Review it in the Parent Center.`;
    const w = held({
      hosted_games: [{ id: "g1", title }],
      notifications: [notice("mom", body, "2026-11-21T00:00:00.000Z")],
    });
    const p = await plan(w);
    expect(p.messages.map((m) => [m.userId, m.body])).toEqual([["dad", body]]);
  });

  it("is sent once: a retry, a second tap or the invitation answered again finds the notice and sends nothing", async () => {
    const w = held();
    const admin = fakeAdmin(w) as any;
    const push = vi.fn(async () => ({ ok: true }));
    const ask = () =>
      planGuardianApprovalPush(admin, { kind: "invite_accept", id: "gi1", callerId: "kid" });
    expect(await sendGuardianApprovalPush(admin, await ask(), { push })).toBe(2);
    expect(push).toHaveBeenCalledTimes(2);
    expect(
      admin.inserted.map((i: any) => [i.row.user_id, i.row.type, i.row.body, i.row.link]),
    ).toEqual([
      ["mom", GUARDIAN_APPROVAL_TYPE, HELD_BODY, "/parent?request=jr9"],
      ["dad", GUARDIAN_APPROVAL_TYPE, HELD_BODY, "/parent?request=jr9"],
    ]);
    push.mockClear();
    const again = await ask();
    expect(again.messages).toEqual([]);
    expect(await sendGuardianApprovalPush(admin, again, { push })).toBe(0);
    expect(push).not.toHaveBeenCalled();
    expect(admin.inserted).toHaveLength(2);
  });

  it("an earlier notice in this attempt counts however old it is (no one-hour limit on the plan's check)", async () => {
    const w = held({
      notifications: [
        notice("mom", HELD_BODY, "2026-11-20T11:00:00.000Z"),
        notice("dad", HELD_BODY, "2026-11-20T11:00:00.000Z"),
      ],
    });
    // Days after those notices (the stub keeps no clock; the plan's check has no upper bound).
    expect((await plan(w)).messages).toEqual([]);
  });

  it("a notice that names this request counts even when its words differ (the child was renamed)", async () => {
    const w = held({
      notifications: [
        {
          ...notice(
            "mom",
            "Nate requested a spot in Sunday 14U scrimmage. Review it in the Parent Center.",
            "2026-11-20T10:05:00.000Z",
          ),
          link: guardianRequestLink("jr9"),
        },
      ],
    });
    expect((await plan(w)).messages.map((m) => m.userId)).toEqual(["dad"]);
  });

  it("a notice about another game with the same title does not count, and the send does not drop the new one", async () => {
    // The host declined the request on game A ("Sunday 14U scrimmage") at 08:00; at 09:00 the child accepted an
    // invitation to game B with the same title and mom was told; at 09:20 the child accepts A's new invitation.
    const now = Date.parse("2026-11-22T09:20:00.000Z");
    const w = held({
      join_requests: [
        {
          ...held().join_requests![0],
          created_at: "2026-11-01T00:00:00.000Z",
          last_rejected_at: "2026-11-22T08:00:00.000Z",
        },
      ],
      notifications: [
        {
          ...notice("mom", HELD_BODY, "2026-11-22T09:00:00.000Z"),
          link: guardianRequestLink("jr-game-b"),
        },
      ],
    });
    const admin = fakeAdmin(w) as any;
    const p = await planGuardianApprovalPush(admin, {
      kind: "invite_accept",
      id: "gi1",
      callerId: "kid",
    });
    expect(p.messages.map((m) => m.userId).sort()).toEqual(["dad", "mom"]);
    const push = vi.fn(async () => ({ ok: true }));
    expect(await sendGuardianApprovalPush(admin, p, { push, now: () => now })).toBe(2);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("a held notice, a decline, then a new accept inside the hour: the guardian is told again (the send's window starts at the attempt)", async () => {
    // Mom and dad were told at 10:00 about the first held accept; the guardian declined at 10:10 (Declined by
    // guardian stamps last_rejected_at); the host invited again and the child accepts at 10:20.
    const now = Date.parse("2026-11-22T10:20:00.000Z");
    const w = held({
      join_requests: [
        {
          ...held().join_requests![0],
          created_at: "2026-11-22T09:55:00.000Z",
          last_rejected_at: "2026-11-22T10:10:00.000Z",
        },
      ],
      notifications: [
        {
          ...notice("mom", HELD_BODY, "2026-11-22T10:00:00.000Z"),
          link: guardianRequestLink("jr9"),
        },
        {
          ...notice("dad", HELD_BODY, "2026-11-22T10:00:00.000Z"),
          link: guardianRequestLink("jr9"),
        },
      ],
    });
    const admin = fakeAdmin(w) as any;
    const p = await planGuardianApprovalPush(admin, {
      kind: "invite_accept",
      id: "gi1",
      callerId: "kid",
    });
    expect(p.messages.map((m) => m.userId).sort()).toEqual(["dad", "mom"]);
    const push = vi.fn(async () => ({ ok: true }));
    expect(await sendGuardianApprovalPush(admin, p, { push, now: () => now })).toBe(2);
    expect(push).toHaveBeenCalledTimes(2);
    expect(admin.inserted).toHaveLength(2);
    // Still a backstop inside the attempt: the same plan sent again (two pings at once) sends nothing more.
    push.mockClear();
    expect(await sendGuardianApprovalPush(admin, p, { push, now: () => now })).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });

  it("tells the guardians when the earlier notices cannot be read (as the pending request's send does)", async () => {
    const admin = fakeAdmin(held()) as any;
    const from = admin.from.bind(admin);
    admin.from = (table: string) => {
      if (table !== "notifications") return from(table);
      const q: any = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        limit: () => q,
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: null, error: { message: "boom" } }),
      };
      return q;
    };
    const p = await planGuardianApprovalPush(admin, {
      kind: "invite_accept",
      id: "gi1",
      callerId: "kid",
    });
    expect(p.messages.map((m) => m.userId).sort()).toEqual(["dad", "mom"]);
    // A read that throws is the same.
    admin.from = (table: string) => {
      if (table !== "notifications") return from(table);
      throw new Error("offline");
    };
    const thrown = await planGuardianApprovalPush(admin, {
      kind: "invite_accept",
      id: "gi1",
      callerId: "kid",
    });
    expect(thrown.messages).toHaveLength(2);
  });

  it("the pending request's own notice is unchanged: an approved request is still not raised as a join request", async () => {
    const p = await planGuardianApprovalPush(fakeAdmin(held()) as any, {
      kind: "join_request",
      id: "jr9",
      callerId: "kid",
    });
    expect(p.messages).toEqual([]);
  });
});

describe("openedAt", () => {
  it("is the later of the insert and the last decline, and the start of time when neither reads", () => {
    expect(openedAt("2026-11-01T00:00:00Z", null)).toBe("2026-11-01T00:00:00.000Z");
    expect(openedAt("2026-11-01T00:00:00Z", "2026-11-22T08:00:00+00:00")).toBe(
      "2026-11-22T08:00:00.000Z",
    );
    expect(openedAt("2026-11-23T00:00:00.123456+00:00", "2026-11-22T08:00:00Z")).toBe(
      "2026-11-23T00:00:00.123Z",
    );
    expect(openedAt("garbage", null)).toBe("1970-01-01T00:00:00.000Z");
  });
});

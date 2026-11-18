/* eslint-disable @typescript-eslint/no-explicit-any -- a hand-rolled in-memory Supabase stub */
import { describe, expect, it } from "vitest";
import {
  BROADCAST_HOURLY_CAP,
  MESSAGE_MAX_AGE_MS,
  dropRecentRepeats,
  planNotification,
  pushAllowed,
  type PlannedNotification,
} from "./notification-plan.server";
import { notifyRequestSchema, type NotifyRequest } from "./notification-requests";
import { toAppPath } from "./deep-links";

type Rows = Record<string, any[]>;

/** Just enough of the query builder: select (with count/head), eq, in, gte, order, limit, maybeSingle. */
export function fakeAdmin(tables: Rows) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let counting = false;
      const q: any = {
        select: (_c?: string, opts?: { count?: string }) => ((counting = !!opts?.count), q),
        eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
        in: (k: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[k]))), q),
        gte: (k: string, v: string) => ((rows = rows.filter((r) => String(r[k]) >= v)), q),
        order: (k: string, o?: { ascending?: boolean }) => {
          const dir = o?.ascending === false ? -1 : 1;
          rows = [...rows].sort((a, b) => (String(a[k]) < String(b[k]) ? -dir : dir));
          return q;
        },
        limit: (n: number) => ((rows = rows.slice(0, n)), q),
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          resolve(
            counting
              ? { data: null, count: rows.length, error: null }
              : { data: rows, error: null },
          ),
      };
      return q;
    },
  };
}

const NOW = Date.parse("2026-11-18T12:00:00Z");
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();
const DAY = 86_400_000;

// People. Uuids, as the request schema wants them.
const HOST = "00000000-0000-4000-8000-0000000000a1";
const PLAYER = "00000000-0000-4000-8000-0000000000b2";
const OTHER = "00000000-0000-4000-8000-0000000000c3";
const STRANGER = "00000000-0000-4000-8000-0000000000d4";
const G = "host-abc123-def456";
const FREE = "host-free01-game01";
const CONV = "00000000-0000-4000-8000-00000000c0c0";
const MSG = "00000000-0000-4000-8000-00000000aaa1";
const POST = "00000000-0000-4000-8000-00000000f00d";

const world = (over: Partial<Rows> = {}): Rows => ({
  hosted_games: [
    {
      id: G,
      host_id: HOST,
      title: "Thursday Run",
      price: 15,
      date: iso(3 * DAY),
      cancel_cutoff_min: 120,
      max_players: 10,
      sport: "Basketball",
      location: "Gym 4",
      cancelled_at: null,
      completed_at: null,
      positions_needed: { Goalie: 1 },
    },
    {
      id: FREE,
      host_id: HOST,
      title: "Free Run",
      price: 0,
      date: iso(3 * DAY),
      cancel_cutoff_min: 120,
      max_players: 8,
      sport: "Soccer",
      location: "Park",
      cancelled_at: null,
      completed_at: null,
    },
  ],
  profiles: [
    { id: HOST, display_name: "Hana" },
    { id: PLAYER, display_name: "Pat" },
    { id: OTHER, display_name: "Oli" },
    { id: STRANGER, display_name: "Stan" },
  ],
  game_participants: [
    { id: "gp1", game_id: G, user_id: PLAYER },
    { id: "gp2", game_id: G, user_id: OTHER },
    { id: "gp3", game_id: G, user_id: HOST },
  ],
  join_requests: [],
  payment_submissions: [],
  game_position_waitlist: [],
  availability_contact_requests: [],
  player_availabilities: [{ id: POST, user_id: PLAYER }],
  conversations: [{ id: CONV, accepted_by: [PLAYER, OTHER] }],
  conversation_participants: [
    { conversation_id: CONV, user_id: PLAYER },
    { conversation_id: CONV, user_id: OTHER },
    { conversation_id: CONV, user_id: STRANGER },
  ],
  messages: [
    {
      id: MSG,
      conversation_id: CONV,
      sender_id: PLAYER,
      body: "see you at 7",
      attachment_name: null,
      deleted_at: null,
      created_at: iso(-30_000),
    },
  ],
  notifications: [],
  notification_preferences: [],
  ...over,
});

const plan = (caller: string, req: NotifyRequest, w: Rows = world()) =>
  planNotification(fakeAdmin(w) as any, caller, req, NOW);

const rowsOf = async (caller: string, req: NotifyRequest, w?: Rows) => {
  const p = await plan(caller, req, w);
  if (!p.ok) throw new Error("refused");
  return p.rows;
};

describe("the request: a type and a row, never words or a link", () => {
  const parse = (d: unknown) => notifyRequestSchema.safeParse(d);

  it("refuses a title, body or link from the app", () => {
    for (const extra of [{ title: "Hi" }, { body: "Click" }, { link: "https://evil.example" }]) {
      expect(
        parse({ type: "payment_reminder", game_id: G, user_id: PLAYER, ...extra }).success,
      ).toBe(false);
    }
  });

  it("refuses a type that is not on the list", () => {
    for (const type of [
      "game",
      "moderation",
      "account_suspended",
      "guardian_approval_needed",
      "announcement",
    ]) {
      expect(parse({ type, user_id: PLAYER, game_id: G }).success).toBe(false);
    }
  });

  it("refuses a game id that is not one (so no path or URL can ride in on it)", () => {
    for (const game_id of ["../admin", "https://evil.example", "g1?x=1", "host-a-b/../../x", ""]) {
      expect(parse({ type: "join_request", game_id }).success).toBe(false);
    }
    expect(parse({ type: "join_request", game_id: G }).success).toBe(true);
    expect(
      parse({ type: "join_request", game_id: "4f9e3c2a-1b2c-4d5e-8f90-123456789abc" }).success,
    ).toBe(true);
  });

  it("does not let a player pick who hears about their request (the host comes from the game)", () => {
    expect(parse({ type: "join_request", game_id: G, user_id: STRANGER }).success).toBe(false);
  });

  it("keeps a host's roster update short and link-free", () => {
    const ok = { type: "game_broadcast", game_id: G, text: "Running 10 min late, court 2" };
    expect(parse(ok).success).toBe(true);
    for (const text of [
      "pay here https://x.io/p",
      "see www.example.org",
      "go to bit.ly/abc",
      "visit evil.com now",
    ]) {
      expect(parse({ ...ok, text }).success).toBe(false);
    }
    expect(parse({ ...ok, text: "x".repeat(281) }).success).toBe(false);
    expect(parse({ ...ok, text: "   " }).success).toBe(false);
  });
});

describe("a player tells the host", () => {
  it("a pending request tells the game's host, in the server's words", async () => {
    const w = world({
      join_requests: [
        {
          game_id: G,
          player_id: STRANGER,
          host_id: HOST,
          status: "pending",
          attempt_count: 1,
          created_at: iso(0),
        },
      ],
    });
    expect(await rowsOf(STRANGER, { type: "join_request", game_id: G }, w)).toEqual([
      {
        user_id: HOST,
        type: "join_request",
        title: "New request to join Thursday Run",
        body: "Tap to review.",
        link: `/games/${G}`,
      },
    ]);
  });

  it("a second attempt reads as resubmitted, from the request itself", async () => {
    const w = world({
      join_requests: [
        {
          game_id: G,
          player_id: STRANGER,
          host_id: HOST,
          status: "pending",
          attempt_count: 2,
          created_at: iso(0),
        },
      ],
    });
    const [r] = await rowsOf(STRANGER, { type: "join_request", game_id: G }, w);
    expect(r).toMatchObject({
      type: "join_resubmitted",
      title: "Resubmitted request: Thursday Run",
    });
  });

  it("no pending request, no notification", async () => {
    expect(await plan(STRANGER, { type: "join_request", game_id: G })).toEqual({ ok: false });
    const w = world({
      join_requests: [
        { game_id: G, player_id: STRANGER, host_id: HOST, status: "approved", created_at: iso(0) },
      ],
    });
    expect(await plan(STRANGER, { type: "join_request", game_id: G }, w)).toEqual({ ok: false });
  });

  it("an unknown game is refused", async () => {
    expect(
      await plan(PLAYER, { type: "participant_joined", game_id: "host-nope00-nope00" }),
    ).toEqual({ ok: false });
  });

  it("a join tells the host only when the caller is on the roster, with the real count", async () => {
    expect(await rowsOf(PLAYER, { type: "participant_joined", game_id: G })).toEqual([
      {
        user_id: HOST,
        type: "participant_joined",
        title: "Pat joined Thursday Run",
        body: "3/10 players confirmed.",
        link: `/games/${G}`,
      },
    ]);
    expect(await plan(STRANGER, { type: "participant_joined", game_id: G })).toEqual({ ok: false });
  });

  it("a leave tells the host only once the caller is off the roster, and not inside the cutoff", async () => {
    expect(await plan(PLAYER, { type: "participant_left", game_id: G })).toEqual({ ok: false });
    expect(await rowsOf(STRANGER, { type: "participant_left", game_id: G })).toEqual([
      {
        user_id: HOST,
        type: "participant_left",
        title: "Stan left Thursday Run",
        body: "Their spot is open again.",
        link: `/games/${G}`,
      },
    ]);
    const soon = world();
    soon.hosted_games[0].date = iso(60 * 60_000); // in an hour; the cutoff is two
    expect(await plan(STRANGER, { type: "participant_left", game_id: G }, soon)).toEqual({
      ok: true,
      rows: [],
    });
    const past = world();
    past.hosted_games[0].date = iso(-DAY);
    expect(await plan(STRANGER, { type: "participant_left", game_id: G }, past)).toEqual({
      ok: false,
    });
  });

  it("the host cannot send a player's notice to themselves", async () => {
    expect(await plan(HOST, { type: "participant_left", game_id: G })).toEqual({ ok: false });
  });

  it("a waitlist join names the position from the waitlist row", async () => {
    const w = world({
      game_position_waitlist: [
        {
          game_id: G,
          user_id: STRANGER,
          position: "Goalie",
          status: "waiting",
          created_at: iso(0),
        },
      ],
    });
    const [r] = await rowsOf(STRANGER, { type: "waitlist_join", game_id: G }, w);
    expect(r).toMatchObject({
      user_id: HOST,
      title: "Stan joined the Goalie waitlist",
      body: "Thursday Run",
    });
    expect(await plan(OTHER, { type: "waitlist_join", game_id: G }, w)).toEqual({ ok: false });
  });

  it("names only a position the host listed (the waitlist row holds whatever the player wrote)", async () => {
    const w = world({
      game_position_waitlist: [
        {
          game_id: G,
          user_id: STRANGER,
          position: "Your account is locked, visit evil.com",
          status: "waiting",
          created_at: iso(0),
        },
      ],
    });
    const [r] = await rowsOf(STRANGER, { type: "waitlist_join", game_id: G }, w);
    expect(r.title).toBe("Stan joined the waitlist");
    expect(JSON.stringify(r)).not.toContain("evil");
  });

  it("a payment proof tells the host the amount and method stored on it", async () => {
    const w = world({
      payment_submissions: [
        {
          game_id: G,
          player_id: PLAYER,
          host_id: HOST,
          status: "pending",
          paid_amount: 15,
          payment_type: "venmo",
          submitted_at: iso(0),
        },
      ],
    });
    const [r] = await rowsOf(PLAYER, { type: "payment_submitted", game_id: G }, w);
    expect(r).toMatchObject({
      user_id: HOST,
      title: "Payment proof to review",
      body: "$15 via Venmo for Thursday Run",
    });
    expect(await plan(OTHER, { type: "payment_submitted", game_id: G }, w)).toEqual({ ok: false });
  });
});

describe("the host tells a player", () => {
  const approved = (game: string, who = PLAYER, extra: object = {}) => ({
    game_id: game,
    player_id: who,
    host_id: HOST,
    status: "approved",
    created_at: iso(0),
    ...extra,
  });

  it("an approval on a paid game points to the pay page with the game's fee", async () => {
    const w = world({ join_requests: [approved(G, STRANGER)] });
    expect(await rowsOf(HOST, { type: "join_approved", game_id: G, user_id: STRANGER }, w)).toEqual(
      [
        {
          user_id: STRANGER,
          type: "join_approved",
          title: "Request approved — payment due for Thursday Run",
          body: "Pay $15 to the host to secure your spot. You'll be added to the roster once payment is confirmed.",
          link: `/games/${G}/pay`,
        },
      ],
    );
    const free = world({ join_requests: [approved(FREE, STRANGER)] });
    const [r] = await rowsOf(
      HOST,
      { type: "join_approved", game_id: FREE, user_id: STRANGER },
      free,
    );
    expect(r).toMatchObject({ title: "You're in: Free Run", link: `/games/${FREE}` });
  });

  it("the decision must be the one saved", async () => {
    const w = world({ join_requests: [approved(G, STRANGER, { status: "pending" })] });
    expect(await plan(HOST, { type: "join_approved", game_id: G, user_id: STRANGER }, w)).toEqual({
      ok: false,
    });
    expect(await plan(HOST, { type: "join_declined", game_id: G, user_id: STRANGER }, w)).toEqual({
      ok: false,
    });
  });

  it("a decline never quotes the host's reason; it points to the game page, where it is shown", async () => {
    const w = world({
      join_requests: [
        approved(G, STRANGER, { status: "rejected", reviewer_notes: "visit evil.com" }),
      ],
    });
    const [r] = await rowsOf(HOST, { type: "join_declined", game_id: G, user_id: STRANGER }, w);
    expect(r.body).toBe("The host declined your request. Open the game to see why.");
    expect(JSON.stringify(r)).not.toContain("evil");
  });

  it("only the game's host can send any of these", async () => {
    const w = world({ join_requests: [approved(G, STRANGER)] });
    for (const type of [
      "join_approved",
      "participant_removed",
      "payment_reminder",
      "waitlist_approved",
    ] as const) {
      expect(await plan(OTHER, { type, game_id: G, user_id: STRANGER }, w)).toEqual({ ok: false });
    }
    expect(await plan(OTHER, { type: "game_broadcast", game_id: G, text: "hi" }, w)).toEqual({
      ok: false,
    });
    expect(await plan(OTHER, { type: "game_time_changed", game_id: G }, w)).toEqual({ ok: false });
  });

  it("a removal needs the player to be, or to have asked to be, on this game", async () => {
    expect(
      await rowsOf(HOST, { type: "participant_removed", game_id: G, user_id: PLAYER }),
    ).toEqual([
      {
        user_id: PLAYER,
        type: "participant_removed",
        title: "Removed from Thursday Run",
        body: "The host removed you from this game.",
        link: `/games/${G}`,
      },
    ]);
    const w = world({ join_requests: [approved(G, STRANGER, { status: "rejected" })] });
    expect(
      (await plan(HOST, { type: "participant_removed", game_id: G, user_id: STRANGER }, w)).ok,
    ).toBe(true);
    expect(
      await plan(HOST, { type: "participant_removed", game_id: G, user_id: STRANGER }),
    ).toEqual({ ok: false });
  });

  it("payment verified and declined follow the submission's saved status", async () => {
    const sub = (status: string) => ({
      game_id: G,
      player_id: PLAYER,
      host_id: HOST,
      status,
      paid_amount: 15,
      payment_type: "zelle",
      submitted_at: iso(0),
    });
    const ok = await rowsOf(
      HOST,
      { type: "payment_verified", game_id: G, user_id: PLAYER },
      world({ payment_submissions: [sub("verified")] }),
    );
    expect(ok[0]).toMatchObject({
      title: "Payment verified for Thursday Run",
      link: `/games/${G}`,
    });
    const no = await rowsOf(
      HOST,
      { type: "payment_rejected", game_id: G, user_id: PLAYER },
      world({ payment_submissions: [sub("rejected")] }),
    );
    expect(no[0]).toMatchObject({
      title: "Payment declined for Thursday Run",
      link: `/games/${G}/pay`,
    });
    expect(
      await plan(
        HOST,
        { type: "payment_verified", game_id: G, user_id: PLAYER },
        world({ payment_submissions: [sub("pending")] }),
      ),
    ).toEqual({ ok: false });
    expect(await plan(HOST, { type: "payment_verified", game_id: G, user_id: PLAYER })).toEqual({
      ok: false,
    });
  });

  it("a payment reminder goes only to someone on a paid game who has not paid or sent proof", async () => {
    const [r] = await rowsOf(HOST, { type: "payment_reminder", game_id: G, user_id: PLAYER });
    expect(r).toEqual({
      user_id: PLAYER,
      type: "payment_reminder",
      title: "Payment reminder · Thursday Run",
      body: "Your $15 spot for Thursday Run is still unpaid. Tap to pay the host.",
      link: `/games/${G}/pay`,
    });
    const approvedOnly = world({ join_requests: [approved(G, STRANGER)] });
    expect(
      (await plan(HOST, { type: "payment_reminder", game_id: G, user_id: STRANGER }, approvedOnly))
        .ok,
    ).toBe(true);
    expect(await plan(HOST, { type: "payment_reminder", game_id: G, user_id: STRANGER })).toEqual({
      ok: false,
    });
    expect(await plan(HOST, { type: "payment_reminder", game_id: FREE, user_id: PLAYER })).toEqual({
      ok: false,
    });
    for (const status of ["verified", "pending"]) {
      const paid = world({
        payment_submissions: [
          { game_id: G, player_id: PLAYER, host_id: HOST, status, submitted_at: iso(0) },
        ],
      });
      expect(
        await plan(HOST, { type: "payment_reminder", game_id: G, user_id: PLAYER }, paid),
      ).toEqual({ ok: false });
    }
  });

  it("a waitlist answer follows the waitlist row", async () => {
    const w = world({
      game_position_waitlist: [
        {
          game_id: G,
          user_id: STRANGER,
          position: "Goalie",
          status: "declined",
          created_at: iso(0),
        },
      ],
    });
    const [r] = await rowsOf(HOST, { type: "waitlist_declined", game_id: G, user_id: STRANGER }, w);
    expect(r).toMatchObject({
      title: "Your Goalie waitlist request was declined",
      body: "Thursday Run",
    });
    expect(
      await plan(HOST, { type: "waitlist_approved", game_id: G, user_id: STRANGER }, w),
    ).toEqual({ ok: false });
  });

  it("a legacy invite needs the host's pending invite request to that player for that game", async () => {
    const acr = {
      from_user_id: HOST,
      to_user_id: STRANGER,
      kind: "invite",
      game_id: G,
      status: "pending",
    };
    const [r] = await rowsOf(
      HOST,
      { type: "game_invite", game_id: G, user_id: STRANGER },
      world({ availability_contact_requests: [acr] }),
    );
    expect(r).toEqual({
      user_id: STRANGER,
      type: "game_invite",
      title: "You're invited to Thursday Run",
      body: "Basketball · Gym 4",
      link: `/games/${G}?invite=1&from=${HOST}`,
    });
    expect(await plan(HOST, { type: "game_invite", game_id: G, user_id: STRANGER })).toEqual({
      ok: false,
    });
    // An invite request for one game does not cover another.
    expect(
      await plan(
        HOST,
        { type: "game_invite", game_id: FREE, user_id: STRANGER },
        world({ availability_contact_requests: [acr] }),
      ),
    ).toEqual({ ok: false });
  });
});

describe("the host tells their roster", () => {
  it("a schedule change reaches everyone on the roster but the host", async () => {
    const out = await rowsOf(HOST, { type: "game_time_changed", game_id: G });
    expect(out.map((r) => r.user_id).sort()).toEqual([PLAYER, OTHER].sort());
    expect(out[0]).toMatchObject({ title: "Schedule updated: Thursday Run", link: `/games/${G}` });
  });

  it("a roster update carries the host's note under the server's title and link", async () => {
    const out = await rowsOf(HOST, {
      type: "game_broadcast",
      game_id: G,
      text: "  Court 2 tonight  ",
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      type: "game_broadcast",
      title: "Host update · Thursday Run",
      body: "Court 2 tonight",
      link: `/games/${G}`,
    });
  });
});

describe("a message tells the rest of the thread", () => {
  it("known contacts get a preview of the stored message; a stranger hears of the opening message, without its words", async () => {
    const out = await rowsOf(PLAYER, { type: "message", message_id: MSG });
    expect(out).toEqual([
      {
        user_id: OTHER,
        type: "message",
        title: "New message from Pat",
        body: "see you at 7",
        link: `/messages/${CONV}`,
      },
      {
        user_id: STRANGER,
        type: "message",
        title: "Message request from Pat",
        body: "They'd like to start a conversation.",
        link: `/messages/${CONV}`,
      },
    ]);
  });

  it("a later message does not reach someone who never accepted the thread", async () => {
    const w = world();
    w.messages.unshift({
      id: "00000000-0000-4000-8000-00000000aaa0",
      conversation_id: CONV,
      sender_id: PLAYER,
      body: "hi",
      deleted_at: null,
      created_at: iso(-60_000),
    });
    const out = await rowsOf(PLAYER, { type: "message", message_id: MSG }, w);
    expect(out.map((r) => r.user_id)).toEqual([OTHER]);
  });

  it("only the sender, only while the message is new, and never a deleted one", async () => {
    expect(await plan(OTHER, { type: "message", message_id: MSG })).toEqual({ ok: false });
    const old = world();
    old.messages[0].created_at = iso(-MESSAGE_MAX_AGE_MS - 1000);
    expect(await plan(PLAYER, { type: "message", message_id: MSG }, old)).toEqual({ ok: false });
    const gone = world();
    gone.messages[0].deleted_at = iso(0);
    expect(await plan(PLAYER, { type: "message", message_id: MSG }, gone)).toEqual({ ok: false });
  });

  it("an attachment is previewed by its name", async () => {
    const w = world();
    Object.assign(w.messages[0], { body: null, attachment_name: "a.jpg" });
    const [r] = await rowsOf(PLAYER, { type: "message", message_id: MSG }, w);
    expect(r.body).toBe("📎 a.jpg");
  });
});

describe("an availability post's author tells the people who asked about it", () => {
  it("reaches each person who sent a request about this post, once", async () => {
    const w = world({
      availability_contact_requests: [
        { availability_id: POST, from_user_id: STRANGER, to_user_id: PLAYER, kind: "contact" },
        { availability_id: POST, from_user_id: STRANGER, to_user_id: PLAYER, kind: "invite" },
        { availability_id: POST, from_user_id: OTHER, to_user_id: PLAYER, kind: "contact" },
      ],
    });
    const out = await rowsOf(PLAYER, { type: "availability_updated", availability_id: POST }, w);
    expect(out.map((r) => r.user_id).sort()).toEqual([OTHER, STRANGER].sort());
    expect(out[0]).toMatchObject({
      title: "Pat updated their availability",
      link: `/players?post=${POST}`,
    });
  });

  it("only the post's author", async () => {
    expect(await plan(STRANGER, { type: "availability_updated", availability_id: POST })).toEqual({
      ok: false,
    });
  });
});

describe("a contact request is no longer a way to message someone", () => {
  // The hole this closes: one availability contact request let the sender's app write any title, body and link
  // to the other person. Now the request alone qualifies the sender for nothing.
  const contactOnly = () =>
    world({
      availability_contact_requests: [
        {
          availability_id: POST,
          from_user_id: STRANGER,
          to_user_id: PLAYER,
          kind: "contact",
          status: "pending",
        },
      ],
      hosted_games: [
        ...world().hosted_games,
        {
          ...world().hosted_games[0],
          id: "host-strng0-game00",
          host_id: STRANGER,
          title: "Your account is locked, visit evil.com",
        },
      ],
    });

  it("every host-to-player type is refused for someone who is not on the sender's game", async () => {
    const w = contactOnly();
    for (const type of [
      "join_approved",
      "join_declined",
      "participant_removed",
      "payment_verified",
      "payment_rejected",
      "payment_reminder",
      "waitlist_approved",
      "waitlist_declined",
      "game_invite",
    ] as const) {
      expect(
        await plan(STRANGER, { type, game_id: "host-strng0-game00", user_id: PLAYER }, w),
      ).toEqual({ ok: false });
    }
  });

  it("and the roster types reach nobody outside the sender's own roster", async () => {
    const w = contactOnly();
    expect(
      await rowsOf(STRANGER, { type: "game_time_changed", game_id: "host-strng0-game00" }, w),
    ).toEqual([]);
    expect(
      await rowsOf(
        STRANGER,
        { type: "game_broadcast", game_id: "host-strng0-game00", text: "hi" },
        w,
      ),
    ).toEqual([]);
  });
});

describe("every link is an in-app path the server built", () => {
  it("survives toAppPath unchanged, whatever the game is called", async () => {
    const w = world({
      join_requests: [
        { game_id: G, player_id: STRANGER, host_id: HOST, status: "approved", created_at: iso(0) },
      ],
      game_position_waitlist: [
        {
          game_id: G,
          user_id: STRANGER,
          position: "https://evil.example",
          status: "approved",
          created_at: iso(0),
        },
      ],
    });
    w.hosted_games[0].title = "https://evil.example/login";
    const out = [
      ...(await rowsOf(HOST, { type: "join_approved", game_id: G, user_id: STRANGER }, w)),
      ...(await rowsOf(HOST, { type: "waitlist_approved", game_id: G, user_id: STRANGER }, w)),
      ...(await rowsOf(HOST, { type: "game_time_changed", game_id: G }, w)),
      ...(await rowsOf(PLAYER, { type: "message", message_id: MSG }, w)),
    ];
    for (const r of out) {
      expect(r.link.startsWith("/")).toBe(true);
      expect(toAppPath(r.link)).toBe(r.link);
      expect(r.link).not.toContain("evil");
      if (r.type.startsWith("waitlist")) expect(r.title).toBe("You're approved from the waitlist");
      expect(r.title.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("repeats", () => {
  const row = (over: Partial<PlannedNotification> = {}): PlannedNotification => ({
    user_id: PLAYER,
    type: "payment_reminder",
    title: "Payment reminder · Thursday Run",
    body: "Your $15 spot for Thursday Run is still unpaid. Tap to pay the host.",
    link: `/games/${G}/pay`,
    ...over,
  });

  it("drops what the person was told a moment ago, and only that", async () => {
    const w = world({ notifications: [{ ...row(), created_at: iso(-5 * 60_000) }] });
    const kept = await dropRecentRepeats(
      fakeAdmin(w) as any,
      [row(), row({ user_id: OTHER })],
      NOW,
    );
    expect(kept.map((r) => r.user_id)).toEqual([OTHER]);
  });

  it("sends it again once the window has passed", async () => {
    const w = world({ notifications: [{ ...row(), created_at: iso(-2 * 60 * 60_000) }] });
    expect(await dropRecentRepeats(fakeAdmin(w) as any, [row()], NOW)).toHaveLength(1);
  });

  it("caps a host's roster updates per player per hour", async () => {
    const b = (i: number) =>
      row({
        type: "game_broadcast",
        title: "Host update · Thursday Run",
        body: `note ${i}`,
        link: `/games/${G}`,
      });
    const sent = Array.from({ length: BROADCAST_HOURLY_CAP }, (_, i) => ({
      ...b(i),
      created_at: iso(-(i + 1) * 60_000),
    }));
    expect(
      await dropRecentRepeats(
        fakeAdmin(world({ notifications: sent.slice(1) })) as any,
        [b(99)],
        NOW,
      ),
    ).toHaveLength(1);
    expect(
      await dropRecentRepeats(fakeAdmin(world({ notifications: sent })) as any, [b(99)], NOW),
    ).toHaveLength(0);
  });
});

describe("push follows the recipient's preferences", () => {
  it("skips someone who turned message pushes off; a failed read pushes to nobody", async () => {
    const rows: PlannedNotification[] = [
      { user_id: PLAYER, type: "message", title: "t", body: null, link: "/messages/x" },
      { user_id: OTHER, type: "message", title: "t", body: null, link: "/messages/x" },
    ];
    const w = world({
      notification_preferences: [{ user_id: OTHER, prefs: { messages: { push: false } } }],
    });
    const yes = await pushAllowed(fakeAdmin(w) as any, rows);
    expect([...yes].map((r) => r.user_id)).toEqual([PLAYER]);
    const broken = {
      from: () => ({
        select: () => ({ in: async () => ({ data: null, error: { message: "down" } }) }),
      }),
    };
    expect((await pushAllowed(broken as any, rows)).size).toBe(0);
  });
});

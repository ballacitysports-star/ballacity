/**
 * Tells a child's guardians, by push and in the app, that something is waiting
 * for their approval: a game join request or a team invite for their child.
 *
 * It runs on the server because the caller (the child asking to join, or the
 * manager inviting them) must not be trusted to say who the guardians are or
 * what to tell them. The caller only names the request or invite; everything
 * else is read here, and the caller must be the one who made it.
 *
 * Team invites already get an in-app notification for guardians from the
 * database; a join request does not, so that one is written here too. Neither
 * had a push.
 *
 * A game invitation a child accepts can leave the place waiting for the guardian
 * (game_respond_invite answers on_roster false and the request is approved with
 * no guardian approval: 980 section 5, 20261130110000). That request is in the
 * guardian's Parent Center list like a pending one, so the guardian is told the
 * same way ("invite_accept", named by the invitation).
 */

import type { PendingApprovalKind } from "./guardian-approval-kinds";
import { guardianLinksInForce } from "./guardian-links-in-force.server";

export type { PendingApprovalKind };

type Admin = { from: (table: string) => any };

export type GuardianMessage = {
  userId: string;
  title: string;
  body: string;
  url: string;
};

export type GuardianPlan = {
  /** Whether the app should also write a notification row for each guardian. */
  writeNotification: boolean;
  messages: GuardianMessage[];
  /**
   * invite_accept only: when the request's current attempt began. The send's duplicate check looks no further back
   * than this, so a notice about an earlier attempt (before a decline) does not stop the one about this attempt.
   */
  dedupeSince?: string;
};

const NOTHING: GuardianPlan = { writeNotification: false, messages: [] };

/** Where a guardian approves: the Parent Center lists every pending item. */
export const GUARDIAN_APPROVAL_LINK = "/parent";
export const GUARDIAN_APPROVAL_TYPE = "guardian_approval_needed";

/**
 * The link of a notice about a game join request: the Parent Center, named by the request (the page ignores the
 * parameter). The name is what tells this request's notices from another game's with the same title and child name.
 * Notices written before it was added link to the plain Parent Center.
 */
export const guardianRequestLink = (requestId: string) =>
  `${GUARDIAN_APPROVAL_LINK}?request=${encodeURIComponent(requestId)}`;

async function one<T>(
  admin: Admin,
  table: string,
  columns: string,
  match: Record<string, string>,
): Promise<T | null> {
  let q = admin.from(table).select(columns);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data } = await q.maybeSingle();
  return (data as T | null) ?? null;
}

/** The words for a join request (pending) and for an accepted invitation held for the guardian. */
const requestedWhat = (title: string) => `requested a spot in ${title}`;
const acceptedWhat = (title: string) => `accepted an invitation to ${title}`;
const approvalBody = (name: string, what: string) =>
  `${name} ${what}. Review it in the Parent Center.`;

/**
 * Works out who to tell and what to say. Returns nothing to send when the
 * caller is not the one who made the request or invite, when it is no longer
 * waiting, when the child has no active guardian, or when the guardian has
 * switched the child's notifications off.
 *
 * For an accepted invitation it also leaves out each guardian already told
 * about this request since it was last opened (see alreadyTold).
 */
export async function planGuardianApprovalPush(
  admin: Admin,
  input: { kind: PendingApprovalKind; id: string; callerId: string },
): Promise<GuardianPlan> {
  let childId: string;
  let what: string;
  let url = GUARDIAN_APPROVAL_LINK;
  /** invite_accept only: the request's link, what an older notice about it said, and since when a notice counts. */
  let told: { link: string; since: string; whats: string[] } | null = null;

  if (input.kind === "join_request") {
    const req = await one<{
      id: string;
      player_id: string;
      game_id: string;
      status: string;
      guardian_approved_at: string | null;
    }>(admin, "join_requests", "id, player_id, game_id, status, guardian_approved_at", {
      id: input.id,
    });
    // Only the child who asked can say "I asked": nobody can nudge a guardian about someone else.
    if (!req || req.player_id !== input.callerId) return NOTHING;
    if (req.status !== "pending" || req.guardian_approved_at) return NOTHING;
    const game = await one<{ title: string | null }>(admin, "hosted_games", "title", {
      id: req.game_id,
    });
    childId = req.player_id;
    what = requestedWhat(game?.title?.trim() || "a game");
    // The stored id, not the caller's text: Postgres finds a uuid however it is spelt (letter case, braces, no
    // hyphens), so a link built from the caller's spelling would differ each time and slip past the send's duplicate
    // check, which matches the link.
    url = guardianRequestLink(req.id);
  } else if (input.kind === "invite_accept") {
    // game_invites is not in the generated types; the service role reads it.
    const inv = await one<{
      invitee_id: string;
      game_id: string;
      status: string;
      join_request_id: string | null;
    }>(admin, "game_invites", "invitee_id, game_id, status, join_request_id", { id: input.id });
    // Only the invitee who accepted can say so.
    if (!inv || inv.invitee_id !== input.callerId) return NOTHING;
    if (inv.status !== "accepted" || !inv.join_request_id) return NOTHING;
    const req = await one<{
      player_id: string;
      game_id: string;
      status: string;
      guardian_approved_at: string | null;
      created_at: string;
      last_rejected_at: string | null;
    }>(
      admin,
      "join_requests",
      "player_id, game_id, status, guardian_approved_at, created_at, last_rejected_at",
      { id: inv.join_request_id },
    );
    if (!req || req.player_id !== input.callerId || req.game_id !== inv.game_id) return NOTHING;
    // Held for the guardian: approved (the accept approved it) with no guardian approval, and no place yet. A
    // request the accept left declined (a guarded child already on the roster) or one a guardian already approved
    // is not waiting for them.
    if (req.status !== "approved" || req.guardian_approved_at) return NOTHING;
    const seated = await one<{ id: string }>(admin, "game_participants", "id", {
      game_id: req.game_id,
      user_id: req.player_id,
    });
    if (seated) return NOTHING;
    const game = await one<{ title: string | null }>(admin, "hosted_games", "title", {
      id: req.game_id,
    });
    const title = game?.title?.trim() || "a game";
    childId = req.player_id;
    what = acceptedWhat(title);
    url = guardianRequestLink(inv.join_request_id);
    told = {
      link: url,
      since: openedAt(req.created_at, req.last_rejected_at),
      whats: [requestedWhat(title), acceptedWhat(title)],
    };
  } else {
    const inv = await one<{
      invitee_id: string;
      invited_by: string;
      team_id: string;
      status: string;
      guardian_approved_at: string | null;
    }>(admin, "team_invites", "invitee_id, invited_by, team_id, status, guardian_approved_at", {
      id: input.id,
    });
    if (!inv || inv.invited_by !== input.callerId) return NOTHING;
    if (inv.status !== "pending" || inv.guardian_approved_at) return NOTHING;
    // Written while a block stood between the manager and the child: it does not exist for the
    // child or their guardians (team_invite_suppressions), so nobody is told.
    const held = await one<{ invite_id: string }>(admin, "team_invite_suppressions", "invite_id", {
      invite_id: input.id,
    });
    if (held) return NOTHING;
    const team = await one<{ name: string | null }>(admin, "teams", "name", { id: inv.team_id });
    childId = inv.invitee_id;
    what = `was invited to join ${team?.name?.trim() || "a team"}`;
  }

  const controls = await one<{ notifications: boolean | null }>(
    admin,
    "child_controls",
    "notifications",
    { child_user_id: childId },
  );
  if (controls?.notifications === false) return NOTHING;

  // Only the links in force: a guardian whose child has turned 18 is not told about their requests (20261125200000).
  const { data: links } = await guardianLinksInForce(admin, [childId]);
  const guardianIds: string[] = Array.from(new Set((links ?? []).map((l) => l.parent_user_id)));
  if (guardianIds.length === 0) return NOTHING;

  const profile = await one<{ display_name: string | null }>(admin, "profiles", "display_name", {
    id: childId,
  });
  const name = profile?.display_name?.trim() || "Your child";

  let toTell = guardianIds;
  if (told) {
    const earlier = { ...told, bodies: told.whats.map((w) => approvalBody(name, w)) };
    const known = await Promise.all(guardianIds.map((g) => alreadyTold(admin, g, earlier)));
    toTell = guardianIds.filter((_, i) => !known[i]);
    if (toTell.length === 0) return NOTHING;
  }

  return {
    writeNotification: input.kind !== "team_invite",
    messages: toTell.map((userId) => ({
      userId,
      title: "Approval needed",
      body: approvalBody(name, what),
      url,
    })),
    ...(told ? { dedupeSince: told.since } : {}),
  };
}

/**
 * When the request's current attempt began: its insert, or the last time it was declined (a decline ends an attempt;
 * whatever reopens it, a resend or an accept, starts the next one). An invalid time counts as the start of time, so
 * every earlier notice counts and nobody is told twice on a guess.
 */
export function openedAt(createdAt: string, lastRejectedAt: string | null): string {
  const times = [createdAt, lastRejectedAt]
    .map((t) => (t ? Date.parse(t) : Number.NaN))
    .filter((t) => Number.isFinite(t));
  return new Date(times.length ? Math.max(...times) : 0).toISOString();
}

/**
 * Whether this guardian was already told about the request since its current attempt began: a guardian approval
 * notice about this request written since then. The request row cannot say what it was before the accept, so the
 * guardian's notices are the record:
 * - a request the accept created, or reopened from a decline: the notices before (if any) predate the attempt, so the
 *   guardian is told;
 * - a request already waiting for them before the accept (pending, or approved by the host): they were told when it was
 *   sent, so not again;
 * - the same accept raised again (a retry, a second tap, the invitation answered twice): the held notice is there.
 * A notice is about this request when its link names it (guardianRequestLink). A notice written before the link named
 * the request (the plain Parent Center link, or none) counts when its words are the pending request's or the held
 * accept's for this child and game. A failed read counts as not told, as the pending request's send does: the guardian
 * hears of it, and the send's own duplicate check still stops a repeat inside the attempt.
 */
async function alreadyTold(
  admin: Admin,
  guardianId: string,
  earlier: { link: string; since: string; bodies: string[] },
): Promise<boolean> {
  try {
    // Compared here, not in the query: a game title may hold commas, brackets or quotes, which an in-list filter would
    // have to escape. A guardian has few approval notices in one attempt of one request.
    const { data, error } = await admin
      .from("notifications")
      .select("body, link")
      .eq("user_id", guardianId)
      .eq("type", GUARDIAN_APPROVAL_TYPE)
      .gte("created_at", earlier.since)
      .limit(500);
    if (error) return false;
    return ((data ?? []) as { body: string | null; link: string | null }[]).some((n) =>
      n.link === earlier.link
        ? true
        : (!n.link || n.link === GUARDIAN_APPROVAL_LINK) && earlier.bodies.includes(n.body ?? ""),
    );
  } catch {
    return false;
  }
}

/** How long the same message to the same guardian counts as already sent. */
export const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Sends the plan: a notification row where the app owns it (a join request or a
 * held accept; the database already writes one for a team invite), then a push. Where it writes
 * the row, a guardian who already got this exact message (same words, same link) in the last hour (a
 * double tap, a retry) is skipped; for a held accept, only since the request's current attempt
 * began (plan.dedupeSince), so a notice about an attempt a decline ended does not count. Returns how
 * many guardians were told.
 */
export async function sendGuardianApprovalPush(
  admin: Admin,
  plan: GuardianPlan,
  deps: {
    push: (m: GuardianMessage) => Promise<unknown>;
    now?: () => number;
  },
): Promise<number> {
  const now = deps.now ?? Date.now;
  const attempt = plan.dedupeSince ? Date.parse(plan.dedupeSince) : Number.NaN;
  let told = 0;
  for (const m of plan.messages) {
    if (plan.writeNotification) {
      const windowStart = now() - DEDUPE_WINDOW_MS;
      const since = new Date(
        Number.isFinite(attempt) ? Math.max(windowStart, attempt) : windowStart,
      ).toISOString();
      const { data: dup } = await admin
        .from("notifications")
        .select("id")
        .eq("user_id", m.userId)
        .eq("type", GUARDIAN_APPROVAL_TYPE)
        .eq("body", m.body)
        .eq("link", m.url)
        .gte("created_at", since)
        .limit(1);
      if (((dup ?? []) as unknown[]).length > 0) continue;

      // Recorded first, so the Inbox and the push agree and the check above has something to find.
      await admin.from("notifications").insert({
        user_id: m.userId,
        type: GUARDIAN_APPROVAL_TYPE,
        title: m.title,
        body: m.body,
        link: m.url,
      });
    }
    try {
      await deps.push(m);
    } catch {
      /* a push is best effort; the notification row is the record */
    }
    told += 1;
  }
  return told;
}

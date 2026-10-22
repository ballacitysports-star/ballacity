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
 */

export type PendingApprovalKind = "join_request" | "team_invite";

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
};

const NOTHING: GuardianPlan = { writeNotification: false, messages: [] };

/** Where a guardian approves: the Parent Center lists every pending item. */
export const GUARDIAN_APPROVAL_LINK = "/parent";
export const GUARDIAN_APPROVAL_TYPE = "guardian_approval_needed";

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

/**
 * Works out who to tell and what to say. Returns nothing to send when the
 * caller is not the one who made the request or invite, when it is no longer
 * waiting, when the child has no active guardian, or when the guardian has
 * switched the child's notifications off.
 */
export async function planGuardianApprovalPush(
  admin: Admin,
  input: { kind: PendingApprovalKind; id: string; callerId: string },
): Promise<GuardianPlan> {
  let childId: string;
  let what: string;

  if (input.kind === "join_request") {
    const req = await one<{
      player_id: string;
      game_id: string;
      status: string;
      guardian_approved_at: string | null;
    }>(admin, "join_requests", "player_id, game_id, status, guardian_approved_at", {
      id: input.id,
    });
    // Only the child who asked can say "I asked": nobody can nudge a guardian about someone else.
    if (!req || req.player_id !== input.callerId) return NOTHING;
    if (req.status !== "pending" || req.guardian_approved_at) return NOTHING;
    const game = await one<{ title: string | null }>(admin, "hosted_games", "title", {
      id: req.game_id,
    });
    childId = req.player_id;
    what = `asked to join ${game?.title?.trim() || "a game"}`;
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

  const { data: links } = await admin
    .from("guardian_links")
    .select("parent_user_id")
    .eq("child_user_id", childId)
    .eq("status", "active");
  const guardianIds: string[] = Array.from(
    new Set(((links ?? []) as { parent_user_id: string }[]).map((l) => l.parent_user_id)),
  );
  if (guardianIds.length === 0) return NOTHING;

  const profile = await one<{ display_name: string | null }>(admin, "profiles", "display_name", {
    id: childId,
  });
  const name = profile?.display_name?.trim() || "Your child";

  return {
    writeNotification: input.kind === "join_request",
    messages: guardianIds.map((userId) => ({
      userId,
      title: "Approval needed",
      body: `${name} ${what}. Review it in the Parent Center.`,
      url: GUARDIAN_APPROVAL_LINK,
    })),
  };
}

/** How long the same message to the same guardian counts as already sent. */
export const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Sends the plan: a notification row where the app owns it (a join request; the
 * database already writes one for a team invite), then a push. Where it writes
 * the row, a guardian who already got this exact message in the last hour (a
 * double tap, a retry) is skipped. Returns how many guardians were told.
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
  let told = 0;
  for (const m of plan.messages) {
    if (plan.writeNotification) {
      const since = new Date(now() - DEDUPE_WINDOW_MS).toISOString();
      const { data: dup } = await admin
        .from("notifications")
        .select("id")
        .eq("user_id", m.userId)
        .eq("type", GUARDIAN_APPROVAL_TYPE)
        .eq("body", m.body)
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

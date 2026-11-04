/**
 * Fixed wording for notifications and pushes that one user sends to another person who is
 * not a confirmed adult (a minor, or someone whose age is unknown).
 *
 * `public.can_notify` decides WHETHER the caller may notify the recipient. It cannot decide
 * WHAT is said, and createNotificationForUser / sendPushToUser take the title, body and link
 * from the caller. Without this, anyone with a live relationship (a host with a join request,
 * a coach) could put free text and an arbitrary link in a child's inbox or on their phone.
 * For those recipients the caller's text and link are ignored and the wording below is used,
 * chosen by notification type only. Adult recipients are unchanged.
 */

export type NotificationContent = {
  type: string;
  title: string;
  body: string | null;
  link: string | null;
};

type Template = { title: string; body: string | null; link: string };

const GENERIC_TYPE = "general";

const TEMPLATES: Record<string, Template> = {
  message: { title: "New message", body: "Open Messages to read it.", link: "/messages" },
  game_invite: {
    title: "Game invitation",
    body: "You were invited to a game. Open BallaCity to see it.",
    link: "/notifications",
  },
  game_broadcast: {
    title: "Game update",
    body: "The host posted an update to a game you are in.",
    link: "/notifications",
  },
  game_time_changed: {
    title: "Game time changed",
    body: "A game you are in has a new time.",
    link: "/notifications",
  },
  join_declined: {
    title: "Join request declined",
    body: "Your request to join a game was declined.",
    link: "/notifications",
  },
  participant_joined: {
    title: "A player joined",
    body: "Someone joined a game you are in.",
    link: "/notifications",
  },
  participant_left: {
    title: "A player left",
    body: "Someone left a game you are in.",
    link: "/notifications",
  },
  participant_removed: {
    title: "Removed from a game",
    body: "The host removed you from a game.",
    link: "/notifications",
  },
  waitlist_join: {
    title: "Waitlist update",
    body: "There is an update to a game waitlist.",
    link: "/notifications",
  },
  availability_updated: {
    title: "Availability update",
    body: "A player you follow updated their availability.",
    link: "/notifications",
  },
  payment_reminder: {
    title: "Payment reminder",
    body: "A game you are in has a payment due.",
    link: "/payments",
  },
  payment_submitted: { title: "Payment submitted", body: null, link: "/payments" },
  payment_verified: { title: "Payment confirmed", body: null, link: "/payments" },
  payment_rejected: {
    title: "Payment not accepted",
    body: "Open Payments to see what to do next.",
    link: "/payments",
  },
  [GENERIC_TYPE]: {
    title: "New notification",
    body: "Open BallaCity to see it.",
    link: "/notifications",
  },
};

/** The fixed content for a recipient who is not a confirmed adult. Unknown types get the generic one. */
export function minorSafeNotification(type: string | null | undefined): NotificationContent {
  const key = type && Object.prototype.hasOwnProperty.call(TEMPLATES, type) ? type : GENERIC_TYPE;
  const t = TEMPLATES[key]!;
  return { type: key, title: t.title, body: t.body, link: t.link };
}

/**
 * What is actually delivered: the caller's content for a confirmed adult (or a note to oneself),
 * the fixed template for anyone else.
 */
export function shapeNotificationForRecipient(
  input: NotificationContent,
  recipient: { isSelf: boolean; isConfirmedAdult: boolean },
): NotificationContent {
  if (recipient.isSelf || recipient.isConfirmedAdult) return input;
  return minorSafeNotification(input.type);
}

type CohortReader = {
  rpc: (
    fn: "age_cohort_of",
    args: { _user: string },
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** Whether `userId` is a confirmed adult. Fails closed: any error or unknown age is "not an adult". */
export async function isConfirmedAdult(admin: CohortReader, userId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("age_cohort_of", { _user: userId });
    if (error) return false;
    return data === "adult";
  } catch {
    return false;
  }
}

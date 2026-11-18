import { z } from "zod";

/**
 * What a signed-in app may ask the server to tell another member (createNotificationForUser).
 *
 * The app never sends a title, body or link. It names the notification type and the row it is about (a game, a
 * message, an availability post) and, where the sender picks among several people, the recipient. The server checks
 * that the caller holds the right role on that row (the game's host, the player with the request, the message's
 * sender...), works out who may receive it, and writes every word and the link itself from the stored rows
 * (notification-plan.server.ts). Anything else is refused.
 *
 * The one exception is a host's roster update (game_broadcast): the host's own short note, to the people on their own
 * game's roster, with no links, under a title the server writes.
 */

/** hosted_games ids: a uuid or the app's own "host-<base36>-<base36>" form (game-flow-status.ts). */
const GAME_ID_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|host-[a-z0-9]+-[a-z0-9]+)$/i;

const gameId = z.string().max(64).regex(GAME_ID_RE, "Invalid game id");
const userId = z.string().uuid();

/** A host's roster note: short, and never a link (refused rather than stripped, so the host knows). */
export const BROADCAST_MAX = 280;
const LINKISH_RE =
  /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|app|me|ly|gg|xyz|info|biz|link|site|online|club|us|uk|ca)\b)/i;

export function broadcastHasLink(text: string): boolean {
  return LINKISH_RE.test(text);
}

const broadcastText = z
  .string()
  .trim()
  .min(1)
  .max(BROADCAST_MAX)
  .refine((t) => !broadcastHasLink(t), "Links can't be sent in a roster update.");

export const notifyRequestSchema = z.discriminatedUnion("type", [
  // A player tells the game's host. The recipient is always the host, read from the game.
  z.object({ type: z.literal("join_request"), game_id: gameId }).strict(),
  z.object({ type: z.literal("participant_joined"), game_id: gameId }).strict(),
  z.object({ type: z.literal("participant_left"), game_id: gameId }).strict(),
  z.object({ type: z.literal("waitlist_join"), game_id: gameId }).strict(),
  z.object({ type: z.literal("payment_submitted"), game_id: gameId }).strict(),

  // The host tells one player of their game.
  z.object({ type: z.literal("join_approved"), game_id: gameId, user_id: userId }).strict(),
  z.object({ type: z.literal("join_declined"), game_id: gameId, user_id: userId }).strict(),
  z.object({ type: z.literal("participant_removed"), game_id: gameId, user_id: userId }).strict(),
  z.object({ type: z.literal("payment_verified"), game_id: gameId, user_id: userId }).strict(),
  z.object({ type: z.literal("payment_rejected"), game_id: gameId, user_id: userId }).strict(),
  z.object({ type: z.literal("payment_reminder"), game_id: gameId, user_id: userId }).strict(),
  z.object({ type: z.literal("waitlist_approved"), game_id: gameId, user_id: userId }).strict(),
  z.object({ type: z.literal("waitlist_declined"), game_id: gameId, user_id: userId }).strict(),
  // Legacy invite through an availability contact request (kind 'invite'); WP 2.0 writes invites in the database.
  z.object({ type: z.literal("game_invite"), game_id: gameId, user_id: userId }).strict(),

  // The host tells their whole roster; the server reads the roster.
  z.object({ type: z.literal("game_time_changed"), game_id: gameId }).strict(),
  z.object({ type: z.literal("game_broadcast"), game_id: gameId, text: broadcastText }).strict(),

  // The sender of a message tells the other people in the conversation.
  z.object({ type: z.literal("message"), message_id: z.string().uuid() }).strict(),

  // The author of an availability post tells the people who asked about it.
  z
    .object({ type: z.literal("availability_updated"), availability_id: z.string().uuid() })
    .strict(),
]);

export type NotifyRequest = z.infer<typeof notifyRequestSchema>;
export type NotifyType = NotifyRequest["type"];

/** Every type the app may ask for; anything else is refused before the handler runs. */
export const CLIENT_NOTIFY_TYPES: readonly NotifyType[] = notifyRequestSchema.options.map(
  (o) => o.shape.type.value,
);

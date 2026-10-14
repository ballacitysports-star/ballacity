/**
 * Turns the database's minor-messaging refusal into something the person
 * trying to send can act on.
 *
 * The guard used to raise one blanket line — "messaging between adults and
 * minors is not available" — which was both wrong and unhelpful. It is not a
 * blanket rule: an adult may message a 16-17 year old, may message a 13-15
 * year old they share a game with, and may message a child they are guardian
 * of. A host who only needed the player to join their game first was told
 * none of that.
 *
 * `create_direct_conversation` (and the send-time trigger) raise
 * `MINOR_MESSAGING_BLOCKED:<code>:<side>`. The code names the rule; the side
 * says whose restriction it is — `self` when it is the sender's own account
 * (a teen messaging a host), `other` when it is the recipient's (a host
 * messaging a teen). Older databases send only the code.
 *
 * What to say depends on both, and on who is being messaged: "once they've
 * joined one of your games" is right for a host messaging a player and wrong,
 * read the other way, for a player messaging that host.
 */

export const MINOR_MESSAGING_PREFIX = "MINOR_MESSAGING_BLOCKED:";

export type MinorMessagingReason =
  | "messaging_off"
  | "guardian_only"
  | "teammates_only"
  | "child_needs_guardian"
  | "child_needs_shared_game"
  | "teen_needs_shared_game";

/** Whose account the refusing rule applies to, from the sender's view. */
export type MinorMessagingSide = "self" | "other";

/**
 * Who the viewer was trying to reach, as the calling screen knows it.
 *
 * - `player`: a player from a profile, list or roster.
 * - `game_player`: a player who joined or asked to join the viewer's game.
 * - `host`: the host of the game the viewer is looking at.
 * - `team_leader`: a team's coach or manager.
 * - `guardian`: another player's parent or guardian.
 * - `chat`: whoever is on the other end of an open conversation.
 */
export type MessagingRecipient =
  "player" | "game_player" | "host" | "team_leader" | "guardian" | "chat";

const KNOWN: ReadonlySet<string> = new Set<MinorMessagingReason>([
  "messaging_off",
  "guardian_only",
  "teammates_only",
  "child_needs_guardian",
  "child_needs_shared_game",
  "teen_needs_shared_game",
]);

const NOUN: Record<MessagingRecipient, string> = {
  player: "this player",
  game_player: "this player",
  host: "this host",
  team_leader: "this team leader",
  guardian: "this parent or guardian",
  chat: "this person",
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The shared-game rules: the only ones the two people can resolve themselves. */
function sharedGameMessage(side: MinorMessagingSide | null, to: MessagingRecipient): string {
  switch (to) {
    case "host":
      // Joining this host's game is what creates the shared game, whichever
      // of the two is the minor.
      return "You can message the host once your spot in this game is confirmed.";
    case "game_player":
      return "You can message this player once their spot in your game is confirmed.";
    case "chat":
      return "You can message this person once you're both in the same game.";
    default:
      return side === "self"
        ? `You can message ${NOUN[to]} once you're both in the same game.`
        : `You can message ${NOUN[to]} once they've joined a game with you.`;
  }
}

function describe(
  reason: MinorMessagingReason,
  side: MinorMessagingSide | null,
  to: MessagingRecipient,
): string {
  if (reason === "child_needs_shared_game" || reason === "teen_needs_shared_game") {
    return sharedGameMessage(side, to);
  }
  if (side === "self") {
    switch (reason) {
      case "messaging_off":
        return "Your parent or guardian has turned off direct messages on your account.";
      case "guardian_only":
        return "Your parent or guardian has set your account so you can only message them.";
      case "teammates_only":
        return "Your parent or guardian has set your account so you can only message teammates.";
      case "child_needs_guardian":
        return "Players under 13 can only message their own parent or guardian.";
    }
  }
  // The recipient's restriction, or an older database that did not say whose.
  const who = capitalize(NOUN[to]);
  switch (reason) {
    case "messaging_off":
      return `${who}'s parent or guardian has turned off direct messages.`;
    case "guardian_only":
      return `${who} can only be messaged by their parent or guardian.`;
    case "teammates_only":
      return to === "player" || to === "game_player"
        ? `${who} can only be messaged by teammates. Add them to your team first.`
        : `${who} can only be messaged by teammates.`;
    case "child_needs_guardian":
      return "Players under 13 can only be messaged by their own parent or guardian.";
  }
}

/** Fallback when the database sends a code this build does not know. */
const UNKNOWN =
  "Messaging this player isn't available right now because of their account's safety settings.";

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  // Supabase errors are not always Error instances but carry `message`.
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error ?? "");
}

/**
 * The rule and side inside a raised error, or null when it is not one of
 * these refusals or names a rule this build does not know. Tolerates the
 * surrounding text Postgres and PostgREST wrap around the message.
 */
export function parseMinorMessagingBlock(
  error: unknown,
): { reason: MinorMessagingReason; side: MinorMessagingSide | null } | null {
  const text = errorText(error);
  const at = text.indexOf(MINOR_MESSAGING_PREFIX);
  if (at === -1) return null;
  const rest = text.slice(at + MINOR_MESSAGING_PREFIX.length).trim();
  const m = /^([a-z_]*)(?::([a-z]+))?/i.exec(rest);
  const code = m?.[1]?.toLowerCase() ?? "";
  if (!KNOWN.has(code)) return null;
  const side = m?.[2]?.toLowerCase();
  return {
    reason: code as MinorMessagingReason,
    side: side === "self" || side === "other" ? side : null,
  };
}

/** Just the rule, for callers that do not care whose it is. */
export function parseMinorMessagingReason(error: unknown): MinorMessagingReason | null {
  return parseMinorMessagingBlock(error)?.reason ?? null;
}

/** True when this error is a minor-messaging refusal at all. */
export function isMinorMessagingBlock(error: unknown): boolean {
  return errorText(error).includes(MINOR_MESSAGING_PREFIX);
}

/**
 * What to show the sender. Falls back to the generic line for an unrecognised
 * code so a newer database never surfaces a raw `MINOR_MESSAGING_BLOCKED:` to
 * a user.
 */
export function minorMessagingMessage(
  error: unknown,
  to: MessagingRecipient = "player",
): string | null {
  if (!isMinorMessagingBlock(error)) return null;
  const block = parseMinorMessagingBlock(error);
  return block ? describe(block.reason, block.side, to) : UNKNOWN;
}

/**
 * The message for any failure to open a conversation or send a message: the
 * explained version when it is a minor-messaging refusal, otherwise whatever
 * the caller raised. `to` is who the viewer was trying to reach.
 */
export function describeMessagingError(
  error: unknown,
  fallback = "Couldn't open chat",
  to: MessagingRecipient = "player",
): string {
  return (
    minorMessagingMessage(error, to) ??
    ((error as { message?: unknown } | null)?.message
      ? String((error as { message: unknown }).message)
      : fallback)
  );
}

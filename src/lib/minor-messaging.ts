/**
 * Turns the database's minor-messaging refusal into something a host can act
 * on.
 *
 * The guard used to raise one blanket line — "messaging between adults and
 * minors is not available" — which was both wrong and unhelpful. It is not a
 * blanket rule: an adult may message a 16-17 year old, may message a 13-15
 * year old they share a game with, and may message a child they are guardian
 * of. A host who only needed the player to join their game first was told
 * none of that.
 *
 * `create_direct_conversation` now raises `MINOR_MESSAGING_BLOCKED:<code>`.
 * These map each code to what actually happened and, where the host can do
 * something about it, what that is.
 */

export const MINOR_MESSAGING_PREFIX = "MINOR_MESSAGING_BLOCKED:";

export type MinorMessagingReason =
  | "messaging_off"
  | "guardian_only"
  | "teammates_only"
  | "child_needs_guardian"
  | "child_needs_shared_game"
  | "teen_needs_shared_game";

const MESSAGES: Record<MinorMessagingReason, string> = {
  messaging_off: "This player's parent or guardian has turned off direct messages.",
  guardian_only: "This player can only be messaged by their parent or guardian.",
  teammates_only: "This player can only be messaged by teammates. Add them to your team first.",
  child_needs_guardian: "Players under 13 can only be messaged by their own parent or guardian.",
  // Both of these are the encouraging case: the host is not blocked outright,
  // they simply do not share a game with this player yet.
  child_needs_shared_game: "You can message this player once they've joined one of your games.",
  teen_needs_shared_game: "You can message this player once they've joined one of your games.",
};

/** Fallback when the database sends a code this build does not know. */
const UNKNOWN =
  "Messaging this player isn't available right now because of their account's safety settings.";

/**
 * The reason code inside a raised error, or null when it is not one of these
 * refusals. Tolerates the surrounding text Postgres and PostgREST wrap around
 * the message.
 */
export function parseMinorMessagingReason(error: unknown): MinorMessagingReason | null {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");
  const at = text.indexOf(MINOR_MESSAGING_PREFIX);
  if (at === -1) return null;
  const rest = text.slice(at + MINOR_MESSAGING_PREFIX.length).trim();
  // The code runs until whitespace or punctuation the driver may have added.
  const code = rest.split(/[^a-z_]/i)[0]?.toLowerCase() ?? "";
  return code in MESSAGES ? (code as MinorMessagingReason) : null;
}

/** True when this error is a minor-messaging refusal at all. */
export function isMinorMessagingBlock(error: unknown): boolean {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");
  return text.includes(MINOR_MESSAGING_PREFIX);
}

/**
 * What to show the host. Falls back to the generic line for an unrecognised
 * code so a newer database never surfaces a raw `MINOR_MESSAGING_BLOCKED:` to
 * a user.
 */
export function minorMessagingMessage(error: unknown): string | null {
  if (!isMinorMessagingBlock(error)) return null;
  const reason = parseMinorMessagingReason(error);
  return reason ? MESSAGES[reason] : UNKNOWN;
}

/**
 * The message for any failure to open a conversation: the explained version
 * when it is a minor-messaging refusal, otherwise whatever the caller raised.
 */
export function describeMessagingError(error: unknown, fallback = "Couldn't open chat"): string {
  return (
    minorMessagingMessage(error) ??
    (error instanceof Error && error.message ? error.message : fallback)
  );
}

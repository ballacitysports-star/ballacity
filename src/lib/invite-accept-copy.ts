/**
 * The words after a player accepts a game invitation (GameInviteBanner on the game page, GameInvitationsSection on the
 * Players tab). Kept apart from game-invites so both can be tested without the database client.
 */
/**
 * Shown when the place waits for the player's guardian. It does not say the guardian was told: the ping
 * (respondToGameInvite) is best effort and not awaited, and tells nobody when the guardian has switched the child's
 * notifications off, so the toast cannot know.
 */
export const ACCEPT_HELD_FOR_PARENT =
  "Invitation accepted. Your parent has to approve before you're in.";

/**
 * The toast after an accept. The game page's banner keeps "The host has been told." and the Players tab its own words
 * for a free game (on the roster) and a paid one (pay on the game page); only a place held for the guardian reads
 * differently, on both.
 */
export function inviteAcceptedMessage(
  res: { on_roster?: boolean },
  opts: { waitsForGuardian: boolean; where: "banner" | "list" },
): string {
  if (opts.waitsForGuardian) return ACCEPT_HELD_FOR_PARENT;
  if (opts.where === "banner") return "You're in. The host has been told.";
  return res.on_roster ? "You're in." : "You're in. Open the game to finish joining.";
}

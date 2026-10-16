/** Member-facing copy for AI text screening of posts and comments (client-safe). */

export const POST_BLOCKED_MESSAGE =
  "That can't be posted because it may break our community guidelines. Please keep it respectful and about the game.";

export const POST_HELD_NOTICE =
  "Posted — only you can see it until a quick safety review clears it.";

/** Shows the held notice when a create/edit result says the text was held. */
export function heldNotice(result: unknown): string | null {
  return result && typeof result === "object" && (result as { held?: unknown }).held === true
    ? POST_HELD_NOTICE
    : null;
}

/** The guideline message when a server error is a moderation block; null otherwise. */
export function blockedMessage(error: unknown): string | null {
  return error instanceof Error && error.message === POST_BLOCKED_MESSAGE
    ? POST_BLOCKED_MESSAGE
    : null;
}

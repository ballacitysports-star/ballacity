/**
 * AI screening for member-written posts and comments (server only).
 *
 * Text is screened BEFORE it is stored, so blocked text never reaches the
 * database. Everything else is inserted (the database forces it to 'pending',
 * author-only) and then settled here with the service role:
 *   allow → 'approved' (visible as before)
 *   hold  → 'held'     (author-only until a superadmin approves it)
 * An unavailable checker holds rather than publishes, like every other
 * moderation path.
 */

import { moderateAiText } from "@/lib/ai/moderation.server";

export { POST_BLOCKED_MESSAGE } from "@/lib/post-moderation";

export type PostTextTable = "team_posts" | "post_comments";
export type PostScreen = "allow" | "hold" | "block";
export type PostModerationStatus = "approved" | "held";

export async function screenPostText(
  admin: any,
  input: {
    userId: string;
    table: PostTextTable;
    id?: string | null;
    context: string;
    fields: Record<string, string | null | undefined>;
  },
): Promise<PostScreen> {
  // One check per post (not one per field): labelled parts in a single prompt.
  const text = Object.entries(input.fields)
    .map(([key, value]) => [key, (value ?? "").trim()] as const)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n\n");
  const out = await moderateAiText(admin, {
    userId: input.userId,
    text,
    context: input.context,
    target: {
      table: input.table,
      id: input.id ?? null,
      field: Object.keys(input.fields).join(","),
    },
  });
  if (out.verdict === "block") return "block";
  if (out.verdict === "review" || out.unavailable) return "hold";
  return "allow";
}

/** Records the screen's outcome on a stored row. Only the service role can do this. */
export async function settlePostModeration(
  admin: any,
  table: PostTextTable,
  id: string,
  screen: Exclude<PostScreen, "block">,
): Promise<PostModerationStatus> {
  const status: PostModerationStatus = screen === "allow" ? "approved" : "held";
  const { error } = await admin.from(table).update({ moderation_status: status }).eq("id", id);
  // A failed write leaves the row 'pending' (author-only): safe, never public.
  if (error) return "held";
  return status;
}

export const TEAM_POST_CONTEXT =
  "A post on a community sports team page, read by adults and minors.";
export const COMMENT_CONTEXT =
  "A comment on a team post, game or highlight reel in a community sports app used by adults and minors.";

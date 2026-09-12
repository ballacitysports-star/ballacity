/**
 * Server-only helpers shared by the moderator surfaces.
 * Never import this from client code — it is loaded inside server-fn handlers.
 */

export type ModeratorCtx = { supabase: any; userId: string };

/** Moderator = admin, moderator, or superadmin role. */
export async function assertModerator(ctx: ModeratorCtx) {
  const { data, error } = await ctx.supabase.rpc("is_moderator", {
    _user_id: ctx.userId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

/**
 * Server functions backing team roster invitations.
 *
 * Player search is deliberately server-side and manager-gated: it returns a
 * name/avatar for people the caller may invite, so letting any signed-in user
 * enumerate profiles through it would be a directory leak. The database RPC
 * `is_team_manager` is the authority; this handler re-asks it on every call.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const searchPlayersForTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { teamId: string; q: string }) =>
    z.object({ teamId: z.string().uuid(), q: z.string().min(1).max(80) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isManager, error: roleErr } = await context.supabase.rpc("is_team_manager", {
      _team: data.teamId,
      _user: context.userId,
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isManager) throw new Error("Only the team's owner, managers or coaches can invite players.");

    // Exclude current members and anyone already holding a pending invite so
    // the picker can't produce a request the database will reject.
    const [{ data: members }, { data: invites }] = await Promise.all([
      context.supabase.from("team_members").select("user_id").eq("team_id", data.teamId),
      context.supabase
        .from("team_invites")
        .select("invitee_id")
        .eq("team_id", data.teamId)
        .eq("status", "pending"),
    ]);
    const exclude = new Set<string>([
      context.userId,
      ...(members ?? []).map((m) => m.user_id),
      ...(invites ?? []).map((i) => i.invitee_id),
    ]);

    const term = data.q.replace(/[%_]/g, "").trim();
    if (!term) return [];

    const { data: rows, error } = await context.supabase
      .from("profiles")
      .select("id, display_name, username, avatar_initials, avatar_url")
      .or(`display_name.ilike.%${term}%,username.ilike.%${term}%`)
      .limit(20);
    if (error) throw new Error(error.message);

    return (rows ?? [])
      .filter((r) => !exclude.has(r.id))
      .map((r) => ({
        id: r.id,
        displayName: r.display_name ?? r.username ?? "Player",
        username: r.username ?? null,
        avatarInitials: r.avatar_initials ?? null,
        avatarUrl: r.avatar_url ?? null,
      }));
  });

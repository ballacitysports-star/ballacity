import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  AVAILABILITY_STATUSES,
  describeAvailabilityError,
  type AvailabilityAnswer,
  type AvailabilityStatus,
} from "@/lib/team-availability";

export type MyTeamAvailability = {
  /** The caller and/or their verified-guardian children who are on this team's roster. */
  people: { userId: string; name: string; isSelf: boolean }[];
  events: { id: string; title: string; kind: "tryout" | "clinic"; eventDate: string; location: string | null }[];
  /** Keyed by event id. */
  answers: Record<string, AvailabilityAnswer[]>;
};

/**
 * Upcoming team events the caller can answer availability for: as a roster
 * member themselves, or as the verified guardian of a child on the roster.
 * Both relationships are checked here on the server; showing the roster in
 * the UI grants nothing.
 */
export const getMyTeamAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ teamId: z.string().min(1).max(100) }).parse(i))
  .handler(async ({ data, context }): Promise<MyTeamAvailability> => {
    const empty: MyTeamAvailability = { people: [], events: [], answers: {} };
    // RLS lets a guardian read only their own links; mirror is_guardian_of.
    const { data: links, error: linksError } = await context.supabase
      .from("guardian_links")
      .select("child_user_id")
      .eq("parent_user_id", context.userId)
      .eq("status", "active")
      .not("verified_at", "is", null);
    if (linksError) throw new Error("Could not verify your linked children.");
    const candidates = [context.userId, ...(links ?? []).map((l) => l.child_user_id)];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [members, owner] = await Promise.all([
      supabaseAdmin.from("team_members").select("user_id").eq("team_id", data.teamId).in("user_id", candidates),
      supabaseAdmin.from("teams").select("owner_id").eq("id", data.teamId).maybeSingle(),
    ]);
    if (members.error || owner.error) throw new Error("Could not verify this team.");
    const onTeam = new Set((members.data ?? []).map((m) => m.user_id));
    if (owner.data?.owner_id && candidates.includes(owner.data.owner_id)) onTeam.add(owner.data.owner_id);
    if (onTeam.size === 0) return empty;
    const peopleIds = candidates.filter((id) => onTeam.has(id));

    const { data: posts, error: postsError } = await supabaseAdmin
      .from("team_posts")
      .select("id,title,kind,event_date,location")
      .eq("team_id", data.teamId)
      .in("kind", ["tryout", "clinic"])
      .is("hidden_at", null)
      .eq("moderation_status", "approved")
      .gte("event_date", new Date().toISOString())
      .order("event_date", { ascending: true })
      .limit(20);
    if (postsError) throw new Error("Could not load this team's events.");
    const events = (posts ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      kind: p.kind as "tryout" | "clinic",
      eventDate: p.event_date as string,
      location: p.location,
    }));

    const [profiles, rows] = await Promise.all([
      supabaseAdmin.from("profiles").select("id,display_name,username").in("id", peopleIds),
      events.length
        ? context.supabase
            .from("team_event_availability")
            .select("post_id,user_id,status,note,set_by")
            .in("post_id", events.map((e) => e.id))
            .in("user_id", peopleIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (rows.error) throw new Error("Could not load your availability.");
    const names = new Map((profiles.data ?? []).map((p) => [p.id, p.display_name ?? p.username ?? "Player"]));
    const answers: Record<string, AvailabilityAnswer[]> = {};
    for (const r of rows.data ?? []) {
      (answers[r.post_id] ??= []).push({
        userId: r.user_id,
        status: r.status as AvailabilityStatus,
        note: r.note,
        byGuardian: !!r.set_by && r.set_by !== r.user_id,
      });
    }
    return {
      people: peopleIds.map((id) => ({ userId: id, name: id === context.userId ? "You" : names.get(id) ?? "Your child", isSelf: id === context.userId })),
      events,
      answers,
    };
  });

/** Set (or clear, with status null) one person's availability for one event. */
export const setTeamEventAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        postId: z.string().uuid(),
        userId: z.string().uuid(),
        status: z.enum(AVAILABILITY_STATUSES).nullable(),
        note: z.string().max(200).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // The RPC re-checks guardian link, roster membership and event timing.
    const { error } = await context.supabase.rpc("set_team_event_availability", {
      _post: data.postId,
      _user: data.userId,
      // Null clears the answer; the generated RPC types only know the non-null case.
      _status: data.status as string,
      _note: data.note,
    });
    if (error) throw new Error(describeAvailabilityError(error.message));
    return { ok: true };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeCutoff } from "@/lib/cancel-window";

export type ChildTeam = { teamId: string; name: string; role: string; jersey: number | null; position: string | null };
export type ChildGame = {
  gameId: string;
  title: string;
  sport: string;
  date: string;
  location: string | null;
  /**
   * joined: on the roster · approved: host approved but the spot isn't locked
   * yet (e.g. unpaid) · requested: waiting on the host.
   */
  status: "joined" | "approved" | "requested";
  /** Minutes before start after which cancelling counts as late. 0 = off. */
  cancelCutoffMin: number;
};
export type ChildActivity = {
  childUserId: string;
  name: string;
  avatarUrl: string | null;
  teams: ChildTeam[];
  upcoming: ChildGame[];
  recent: ChildGame[];
  invites: ChildInvite[];
  waivers: ChildWaiver[];
  updates: TeamUpdate[];
  tryouts: ChildTryout[];
};
/** A child's tryout sign-up. Score is shared with guardians; coach notes never are. */
export type ChildTryout = {
  rsvpId: string;
  postId: string;
  teamId: string;
  teamName: string;
  title: string | null;
  eventDate: string | null;
  location: string | null;
  attended: boolean | null;
  score: number | null;
  notes: string | null;
  /** Minutes before start after which cancelling counts as late. 0 = off. */
  cancelCutoffMin: number;
};
export type ChildInvite = {
  id: string;
  teamId: string;
  teamName: string;
  role: string;
  status: string;
  createdAt: string;
  guardianApproved: boolean;
};
export type ChildWaiver = {
  teamId: string;
  teamName: string;
  waiverId: string;
  title: string;
  version: string;
  content: string;
  signedAt: string | null;
  signedByGuardian: boolean;
};
export type TeamUpdate = {
  id: string;
  teamId: string;
  teamName: string;
  kind: string;
  title: string | null;
  body: string | null;
  eventDate: string | null;
  createdAt: string;
};

/**
 * Teams and games for the caller's linked children only. The child list comes
 * from the guardian-scoped `guardian_children_overview` RPC (as the caller),
 * so the privileged reads below are restricted to children this guardian is
 * authorised for — no client-supplied ids are trusted.
 */
export const listChildrenActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChildActivity[]> => {
    const { data: rows, error } = await context.supabase.rpc("guardian_children_overview");
    if (error) throw new Error(error.message);
    const kids = (rows ?? []) as unknown as {
      child_user_id: string;
      display_name: string | null;
      avatar_url: string | null;
    }[];
    if (kids.length === 0) return [];
    const ids = kids.map((k) => k.child_user_id);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [tm, gp, jr] = await Promise.all([
      supabaseAdmin
        .from("team_members")
        .select("team_id,user_id,role,jersey_number,position")
        .in("user_id", ids),
      supabaseAdmin.from("game_participants").select("game_id,user_id").in("user_id", ids),
      supabaseAdmin
        .from("join_requests")
        .select("game_id,player_id,status")
        .in("player_id", ids)
        .in("status", ["pending", "approved"]),
    ]);
    const inv = await supabaseAdmin
      .from("team_invites")
      .select("id,team_id,invitee_id,role,status,created_at,guardian_approved_at")
      .in("invitee_id", ids)
      .order("created_at", { ascending: false })
      .limit(50);
    const memberTeamIds = [...new Set((tm.data ?? []).map((r) => r.team_id))];
    const teamIds = [...new Set([...memberTeamIds, ...(inv.data ?? []).map((r) => r.team_id)])];
    const [wv, sg, posts] = await Promise.all([
      teamIds.length
        ? supabaseAdmin
            .from("team_waivers")
            .select("id,team_id,title,version,content")
            .in("team_id", teamIds)
            .eq("published", true)
        : Promise.resolve({ data: [] as never[] }),
      supabaseAdmin
        .from("team_waiver_signatures")
        .select("waiver_id,signer_user_id,signed_by,signed_at")
        .in("signer_user_id", ids),
      memberTeamIds.length
        ? supabaseAdmin
            .from("team_posts")
            .select("id,team_id,kind,title,body,event_date,created_at")
            .in("team_id", memberTeamIds)
            .is("hidden_at", null)
            .order("created_at", { ascending: false })
            .limit(30)
        : Promise.resolve({ data: [] as never[] }),
    ]);
    const rs = await supabaseAdmin
      .from("tryout_rsvps")
      .select("id,post_id,team_id,user_id,status")
      .in("user_id", ids)
      .neq("status", "cancelled");
    const rsvps = (rs.data ?? []) as { id: string; post_id: string; team_id: string; user_id: string }[];
    const [tp, ev] = await Promise.all([
      rsvps.length
        ? supabaseAdmin.from("team_posts").select("*").in("id", [...new Set(rsvps.map((r) => r.post_id))])
        : Promise.resolve({ data: [] as never[] }),
      rsvps.length
        ? supabaseAdmin.from("tryout_evaluations").select("rsvp_id,attended,score,notes").in("rsvp_id", rsvps.map((r) => r.id))
        : Promise.resolve({ data: [] as never[] }),
    ]);
    for (const r of rsvps) if (!teamIds.includes(r.team_id)) teamIds.push(r.team_id);
    const postById = new Map(((tp.data ?? []) as { id: string; title: string | null; event_date: string | null; location: string | null; share_scores: boolean; share_notes: boolean; cancel_cutoff_min?: number | null }[]).map((x) => [x.id, x]));
    const evalById = new Map(((ev.data ?? []) as { rsvp_id: string; attended: boolean | null; score: number | null; notes: string | null }[]).map((x) => [x.rsvp_id, x]));
    const gameIds = [
      ...new Set([...(gp.data ?? []).map((r) => r.game_id), ...(jr.data ?? []).map((r) => r.game_id)]),
    ];
    const [teams, games] = await Promise.all([
      teamIds.length
        ? supabaseAdmin.from("teams").select("id,name").in("id", teamIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      gameIds.length
        ? supabaseAdmin
            .from("hosted_games")
            .select("*")
            .in("id", gameIds)
        : Promise.resolve({ data: [] as never[] }),
    ]);
    const teamName = new Map((teams.data ?? []).map((t) => [t.id, t.name]));
    const gameById = new Map(
      ((games.data ?? []) as {
        id: string;
        title: string;
        sport: string;
        date: string;
        location: string | null;
        cancelled_at: string | null;
        cancel_cutoff_min?: number | null;
      }[]).map((g) => [g.id, g]),
    );
    const now = Date.now();

    return kids.map((k) => {
      const mk = (gid: string, status: ChildGame["status"]): ChildGame | null => {
        const g = gameById.get(gid);
        if (!g || g.cancelled_at) return null;
        return {
          gameId: g.id, title: g.title, sport: g.sport, date: g.date, location: g.location, status,
          cancelCutoffMin: normalizeCutoff(g.cancel_cutoff_min),
        };
      };
      const onRoster = new Set(
        (gp.data ?? []).filter((r) => r.user_id === k.child_user_id).map((r) => r.game_id),
      );
      const all = [
        ...(gp.data ?? []).filter((r) => r.user_id === k.child_user_id).map((r) => mk(r.game_id, "joined")),
        // Approved but not on the roster yet (e.g. unpaid) still holds a spot; pending is a request.
        ...(jr.data ?? [])
          .filter((r) => r.player_id === k.child_user_id && !onRoster.has(r.game_id))
          .map((r) => mk(r.game_id, r.status === "approved" ? "approved" : "requested")),
      ].filter((g): g is ChildGame => !!g);
      const kidTeams = new Set(
        (tm.data ?? []).filter((r) => r.user_id === k.child_user_id).map((r) => r.team_id),
      );
      const upcoming = all
        .filter((g) => new Date(g.date).getTime() >= now)
        .sort((a, b) => a.date.localeCompare(b.date));
      const recent = all
        .filter((g) => g.status === "joined" && new Date(g.date).getTime() < now)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 5);
      return {
        childUserId: k.child_user_id,
        name: k.display_name ?? "Your child",
        avatarUrl: k.avatar_url,
        teams: (tm.data ?? [])
          .filter((r) => r.user_id === k.child_user_id)
          .map((r) => ({
            teamId: r.team_id,
            name: teamName.get(r.team_id) ?? "Team",
            role: String(r.role),
            jersey: r.jersey_number as number | null,
            position: r.position as string | null,
          })),
        upcoming,
        recent,
        invites: (inv.data ?? [])
          .filter((r) => r.invitee_id === k.child_user_id)
          .map((r) => ({
            id: r.id,
            teamId: r.team_id,
            teamName: teamName.get(r.team_id) ?? "Team",
            role: String(r.role),
            status: String(r.status),
            createdAt: r.created_at,
            guardianApproved: !!r.guardian_approved_at,
          })),
        waivers: ((wv.data ?? []) as { id: string; team_id: string; title: string; version: string; content: string }[])
          .filter((w) => kidTeams.has(w.team_id))
          .map((w) => {
            const sig = (sg.data ?? []).find(
              (x) => x.waiver_id === w.id && x.signer_user_id === k.child_user_id,
            );
            return {
              teamId: w.team_id,
              teamName: teamName.get(w.team_id) ?? "Team",
              waiverId: w.id,
              title: w.title,
              version: w.version,
              content: w.content,
              signedAt: sig?.signed_at ?? null,
              signedByGuardian: !!sig && !!sig.signed_by && sig.signed_by !== k.child_user_id,
            };
          }),
        updates: ((posts.data ?? []) as {
          id: string; team_id: string; kind: string; title: string | null; body: string | null;
          event_date: string | null; created_at: string;
        }[])
          .filter((p) => kidTeams.has(p.team_id))
          .slice(0, 10)
          .map((p) => ({
            id: p.id,
            teamId: p.team_id,
            teamName: teamName.get(p.team_id) ?? "Team",
            kind: p.kind,
            title: p.title,
            body: p.body,
            eventDate: p.event_date,
            createdAt: p.created_at,
          })),
        tryouts: rsvps
          .filter((r) => r.user_id === k.child_user_id && postById.has(r.post_id))
          .map((r) => {
            const p = postById.get(r.post_id)!;
            const e = evalById.get(r.id);
            return {
              rsvpId: r.id, postId: r.post_id, teamId: r.team_id,
              teamName: teamName.get(r.team_id) ?? "Team",
              title: p.title, eventDate: p.event_date, location: p.location,
              attended: e?.attended ?? null,
              score: p.share_scores ? (e?.score ?? null) : null,
              notes: p.share_notes ? (e?.notes || null) : null,
              cancelCutoffMin: normalizeCutoff(p.cancel_cutoff_min),
            };
          })
          .sort((a, b) => (a.eventDate ?? "").localeCompare(b.eventDate ?? "")),
      };
    });
  });

/**
 * A guardian cancels their linked child's game spot (an approved spot, a
 * roster spot, or a pending request). Done in the database by
 * `guardian_cancel_child_game`, which re-checks the guardian link itself, and
 * runs as the guardian so the late-cancellation and refund rules apply as if
 * the child had cancelled. Tryouts use `cancelTryoutRsvp` with `onBehalfOf`.
 */
export const cancelChildGame = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ childUserId: z.string().uuid(), gameId: z.string().min(1).max(200) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("guardian_cancel_child_game", {
      _child: data.childUserId,
      _game: data.gameId,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

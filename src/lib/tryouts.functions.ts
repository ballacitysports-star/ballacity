import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

function publicClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export type TryoutListing = {
  id: string;
  kind: "tryout" | "clinic";
  title: string;
  body: string;
  eventDate: string | null;
  location: string | null;
  price: number | null;
  spotsMax: number | null;
  spotsTaken: number;
  teamId: string;
  teamName: string;
  teamAvatar: string | null;
  sports: string[];
};

/** Public: upcoming tryouts and camps across all visible teams. */
export const listUpcomingTryouts = createServerFn({ method: "GET" }).handler(
  async (): Promise<TryoutListing[]> => {
    const { data, error } = await publicClient()
      .from("team_posts")
      .select("id,kind,title,body,event_date,location,price,spots_max,spots_taken,team_id,teams!inner(name,avatar,sports)")
      .in("kind", ["tryout", "clinic"])
      .is("hidden_at", null)
      .gte("event_date", new Date().toISOString())
      .order("event_date", { ascending: true })
      .limit(12);
    if (error) {
      console.error("listUpcomingTryouts", error.message);
      return [];
    }
    return (data ?? []).map((r: any) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body ?? "",
      eventDate: r.event_date,
      location: r.location,
      price: r.price,
      spotsMax: r.spots_max,
      spotsTaken: r.spots_taken ?? 0,
      teamId: r.team_id,
      teamName: r.teams?.name ?? "Team",
      teamAvatar: r.teams?.avatar ?? null,
      sports: r.teams?.sports ?? [],
    }));
  },
);

/** Signed-in: waiver (if any), my RSVPs, my linked children. */
export const getTryoutRsvpContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ postId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const [w, kids] = await Promise.all([
      sb.rpc("get_tryout_waiver", { _post_id: data.postId }),
      sb.rpc("guardian_children_overview"),
    ]);
    const children = ((kids.data ?? []) as any[]).map((k) => ({
      id: k.child_user_id as string,
      name: (k.display_name as string | null) ?? "Child",
    }));
    const ids = [context.userId, ...children.map((c) => c.id)];
    const [rs, sigs] = await Promise.all([
      sb.from("tryout_rsvps").select("user_id,status").eq("post_id", data.postId).in("user_id", ids),
      (w.data as any[])?.[0]
        ? sb.from("team_waiver_signatures").select("signer_user_id").eq("waiver_id", (w.data as any[])[0].id).in("signer_user_id", ids)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    return {
      waiver: ((w.data as any[]) ?? [])[0] ?? null as null | { id: string; title: string; version: string; content: string },
      children,
      registered: (rs.data ?? []).filter((r) => r.status === "registered").map((r) => r.user_id),
      signed: ((sigs as any).data ?? []).map((s: any) => s.signer_user_id as string),
    };
  });

const ERRORS: Record<string, string> = {
  TRYOUT_FULL: "This event is full.",
  ALREADY_REGISTERED: "Already registered.",
  WAIVER_REQUIRED: "Please read and accept the waiver first.",
  TRYOUT_PASSED: "This event has already happened.",
  NOT_YOUR_GUARDIAN_LINK: "You can only register your own linked children.",
  TRYOUT_NOT_FOUND: "This event is no longer available.",
};
const friendly = (m: string) => ERRORS[Object.keys(ERRORS).find((k) => m.includes(k)) ?? ""] ?? "Something went wrong. Please try again.";

export const rsvpTryout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      postId: z.string().uuid(),
      onBehalfOf: z.string().uuid().nullable(),
      waiverId: z.string().uuid().nullable(),
      attested: z.boolean(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("rsvp_tryout", {
      _post_id: data.postId,
      _on_behalf_of: data.onBehalfOf as any,
      _waiver_id: data.waiverId as any,
      _attested: data.attested,
    });
    if (error) return { ok: false as const, error: friendly(error.message) };
    const { notifyTryoutSignup } = await import("./tryout-alerts.server");
    await notifyTryoutSignup({ postId: data.postId, actorId: context.userId, attendeeId: data.onBehalfOf ?? context.userId, action: "registered" });
    return { ok: true as const };
  });

export const cancelTryoutRsvp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ postId: z.string().uuid(), onBehalfOf: z.string().uuid().nullable() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("cancel_tryout_rsvp", {
      _post_id: data.postId,
      _on_behalf_of: data.onBehalfOf as any,
    });
    if (error) return { ok: false as const, error: friendly(error.message) };
    const { notifyTryoutSignup } = await import("./tryout-alerts.server");
    await notifyTryoutSignup({ postId: data.postId, actorId: context.userId, attendeeId: data.onBehalfOf ?? context.userId, action: "cancelled" });
    return { ok: true as const };
  });

/** Teams the caller can post tryouts for. */
export const listMyManagedTeams = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("team_members")
      .select("team_id, role, teams!inner(name)")
      .eq("user_id", context.userId)
      .in("role", ["owner", "manager", "coach"]);
    return (data ?? []).map((r: any) => ({ id: r.team_id as string, name: r.teams?.name as string }));
  });

/** Manager-only: team roster + tryout RSVPs with waiver status. */
export const getTeamRosterOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ teamId: z.string().min(1) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: isManager } = await context.supabase.rpc("is_team_manager", {
      _team: data.teamId,
      _user: context.userId,
    });
    if (!isManager) throw new Error("Only owners, managers and coaches can view this.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [members, posts, rsvps, waiver, evals] = await Promise.all([
      supabaseAdmin.from("team_members").select("user_id,role,jersey_number,position").eq("team_id", data.teamId),
      supabaseAdmin.from("team_posts").select("id,title,kind,event_date,spots_max,spots_taken").eq("team_id", data.teamId).in("kind", ["tryout", "clinic"]).order("event_date", { ascending: false }),
      supabaseAdmin.from("tryout_rsvps").select("id,post_id,user_id,registered_by,status,created_at").eq("team_id", data.teamId),
      supabaseAdmin.from("team_waivers").select("id,version").eq("team_id", data.teamId).eq("published", true).maybeSingle(),
      context.supabase.from("tryout_evaluations").select("rsvp_id,post_id,attended").eq("team_id", data.teamId),
    ]);
    const attendedByPost = new Map<string, number>();
    for (const e of evals.data ?? []) {
      if (e.attended) attendedByPost.set(e.post_id, (attendedByPost.get(e.post_id) ?? 0) + 1);
    }
    const ids = [...new Set([...(members.data ?? []).map((m) => m.user_id), ...(rsvps.data ?? []).map((r) => r.user_id)])];
    const [profiles, sigs] = await Promise.all([
      ids.length ? supabaseAdmin.from("profiles").select("id,display_name,username,avatar_url").in("id", ids) : Promise.resolve({ data: [] as any[] }),
      waiver.data && ids.length
        ? supabaseAdmin.from("team_waiver_signatures").select("signer_user_id,signed_by,signed_at").eq("waiver_id", waiver.data.id).in("signer_user_id", ids)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const name = new Map((profiles.data ?? []).map((p: any) => [p.id, { name: p.display_name ?? p.username ?? "Player", avatar: p.avatar_url as string | null }]));
    const sig = new Map((sigs.data ?? []).map((s: any) => [s.signer_user_id, { signedAt: s.signed_at as string, byGuardian: !!s.signed_by }]));
    const person = (id: string) => ({ userId: id, ...(name.get(id) ?? { name: "Player", avatar: null }), waiver: sig.get(id) ?? null });
    return {
      waiverVersion: waiver.data?.version ?? null,
      members: (members.data ?? []).map((m) => ({ ...person(m.user_id), role: m.role, jersey: m.jersey_number, position: m.position })),
      events: (posts.data ?? []).map((p) => {
        const eventRsvps = (rsvps.data ?? []).filter((r) => r.post_id === p.id);
        const applied = eventRsvps.filter((r) => r.status === "registered").length;
        const attended = attendedByPost.get(p.id) ?? 0;
        return {
          id: p.id, title: p.title, kind: p.kind, eventDate: p.event_date, spotsMax: p.spots_max, spotsTaken: p.spots_taken ?? 0,
          applied, attended, turnoutPct: applied > 0 ? Math.round((attended / applied) * 100) : null,
          rsvps: eventRsvps.map((r) => ({
            ...person(r.user_id), status: r.status, byGuardian: r.registered_by !== r.user_id, at: r.created_at,
            isMember: (members.data ?? []).some((m) => m.user_id === r.user_id),
          })),
        };
      }),
    };
  });

/** Manager-only: every team invite with response + guardian + waiver status. */
export const getTeamInviteTracker = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ teamId: z.string().min(1) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: isManager } = await context.supabase.rpc("is_team_manager", {
      _team: data.teamId,
      _user: context.userId,
    });
    if (!isManager) throw new Error("Only owners, managers and coaches can view invites.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [inv, waiver] = await Promise.all([
      supabaseAdmin
        .from("team_invites")
        .select("id,invitee_id,role,status,expires_at,responded_at,created_at,guardian_approved_at")
        .eq("team_id", data.teamId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin.from("team_waivers").select("id,version").eq("team_id", data.teamId).eq("published", true).maybeSingle(),
    ]);
    const rows = inv.data ?? [];
    const ids = [...new Set(rows.map((r) => r.invitee_id))];
    const [profiles, sigs, guardians] = await Promise.all([
      ids.length ? supabaseAdmin.from("profiles").select("id,display_name,username,avatar_url").in("id", ids) : Promise.resolve({ data: [] as any[] }),
      waiver.data && ids.length
        ? supabaseAdmin.from("team_waiver_signatures").select("signer_user_id,signed_by").eq("waiver_id", waiver.data.id).in("signer_user_id", ids)
        : Promise.resolve({ data: [] as any[] }),
      ids.length ? supabaseAdmin.from("guardian_links").select("child_user_id").eq("status", "active").in("child_user_id", ids) : Promise.resolve({ data: [] as any[] }),
    ]);
    const p = new Map((profiles.data ?? []).map((x: any) => [x.id, x]));
    const s = new Map((sigs.data ?? []).map((x: any) => [x.signer_user_id, !!x.signed_by]));
    const minors = new Set((guardians.data ?? []).map((g: any) => g.child_user_id));
    const now = Date.now();
    return {
      waiverVersion: waiver.data?.version ?? null,
      invites: rows.map((r) => {
        const pr: any = p.get(r.invitee_id);
        const expired = r.status === "pending" && r.expires_at && new Date(r.expires_at).getTime() < now;
        return {
          id: r.id,
          userId: r.invitee_id,
          name: pr?.display_name ?? pr?.username ?? "Player",
          avatar: (pr?.avatar_url as string | null) ?? null,
          role: r.role as string,
          status: (expired ? "expired" : r.status) as string,
          sentAt: r.created_at,
          respondedAt: r.responded_at,
          needsGuardian: minors.has(r.invitee_id),
          guardianApproved: !!r.guardian_approved_at,
          waiverSigned: s.has(r.invitee_id),
          waiverByGuardian: s.get(r.invitee_id) ?? false,
        };
      }),
    };
  });

/** Public: a single tryout/camp for its sign-up page. */
export const getTryout = createServerFn({ method: "GET" })
  .inputValidator((i) => z.object({ postId: z.string().uuid() }).parse(i))
  .handler(async ({ data }): Promise<TryoutListing | null> => {
    const { data: r, error } = await publicClient()
      .from("team_posts")
      .select("id,kind,title,body,event_date,location,price,spots_max,spots_taken,team_id,teams!inner(name,avatar,sports)")
      .eq("id", data.postId)
      .in("kind", ["tryout", "clinic"])
      .is("hidden_at", null)
      .maybeSingle();
    if (error || !r) return null;
    const x: any = r;
    return {
      id: x.id, kind: x.kind, title: x.title, body: x.body ?? "", eventDate: x.event_date,
      location: x.location, price: x.price, spotsMax: x.spots_max, spotsTaken: x.spots_taken ?? 0,
      teamId: x.team_id, teamName: x.teams?.name ?? "Team", teamAvatar: x.teams?.avatar ?? null, sports: x.teams?.sports ?? [],
    };
  });

/** Manager-only: applicants for one tryout with attendance, score and notes. */
export const getTryoutResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ teamId: z.string().min(1), postId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: isManager } = await context.supabase.rpc("is_team_manager", { _team: data.teamId, _user: context.userId });
    if (!isManager) throw new Error("Only owners, managers and coaches can view this.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rsvps } = await supabaseAdmin
      .from("tryout_rsvps").select("id,user_id,registered_by,status,created_at")
      .eq("team_id", data.teamId).eq("post_id", data.postId).eq("status", "registered");
    const rows = rsvps ?? [];
    const ids = rows.map((r) => r.user_id);
    const [profiles, evals, members, details] = await Promise.all([
      ids.length ? supabaseAdmin.from("profiles").select("id,display_name,username,avatar_url").in("id", ids) : Promise.resolve({ data: [] as any[] }),
      context.supabase.from("tryout_evaluations").select("rsvp_id,attended,score,notes").eq("post_id", data.postId),
      ids.length ? supabaseAdmin.from("team_members").select("user_id,position").eq("team_id", data.teamId).in("user_id", ids) : Promise.resolve({ data: [] as any[] }),
      ids.length ? context.supabase.from("team_roster_details").select("user_id,birth_year").eq("team_id", data.teamId).in("user_id", ids) : Promise.resolve({ data: [] as any[] }),
    ]);
    const prof = new Map((profiles.data ?? []).map((p: any) => [p.id, p]));
    const ev = new Map((evals.data ?? []).map((e: any) => [e.rsvp_id, e]));
    const mem = new Map((members.data ?? []).map((m: any) => [m.user_id, m]));
    const by = new Map((details.data ?? []).map((d: any) => [d.user_id, d.birth_year as number | null]));
    return rows.map((r) => {
      const p: any = prof.get(r.user_id);
      const e: any = ev.get(r.id);
      const m: any = mem.get(r.user_id);
      return {
        rsvpId: r.id, userId: r.user_id, name: p?.display_name ?? p?.username ?? "Player", avatar: (p?.avatar_url ?? null) as string | null,
        byGuardian: r.registered_by !== r.user_id, isMember: mem.has(r.user_id), appliedAt: r.created_at,
        attended: !!e?.attended, score: (e?.score ?? null) as number | null, notes: (e?.notes ?? "") as string,
        birthYear: (by.get(r.user_id) ?? null) as number | null, position: (m?.position ?? "") as string,
      };
    });
  });

export const saveTryoutEvaluation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    teamId: z.string().min(1), postId: z.string().uuid(), rsvpId: z.string().uuid(),
    attended: z.boolean(), score: z.number().int().min(1).max(10).nullable(), notes: z.string().max(1000),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tryout_evaluations").upsert({
      rsvp_id: data.rsvpId, post_id: data.postId, team_id: data.teamId, attended: data.attended,
      score: data.score, notes: data.notes || null, updated_by: context.userId, updated_at: new Date().toISOString(),
    });
    if (error) return { ok: false as const, error: "Couldn't save. Only team managers can score tryouts." };
    return { ok: true as const };
  });

/** Manager-only: email each applicant (or the parent who applied) a tryout invite. */
export const emailTryoutApplicants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ teamId: z.string().min(1), postId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: isManager } = await context.supabase.rpc("is_team_manager", { _team: data.teamId, _user: context.userId });
    if (!isManager) throw new Error("Only owners, managers and coaches can email applicants.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: post } = await supabaseAdmin
      .from("team_posts").select("id,title,event_date,location,team_id,teams!inner(name)")
      .eq("id", data.postId).eq("team_id", data.teamId).maybeSingle();
    if (!post) throw new Error("Tryout not found.");
    const { data: rsvps } = await supabaseAdmin
      .from("tryout_rsvps").select("id,user_id,registered_by")
      .eq("post_id", data.postId).eq("team_id", data.teamId).eq("status", "registered");
    const rows = rsvps ?? [];
    if (!rows.length) return { sent: 0, skipped: 0, failed: 0 };
    const ids = [...new Set(rows.map((r) => r.user_id))];
    const { data: profs } = await supabaseAdmin.from("profiles").select("id,display_name,username").in("id", ids);
    const names = new Map((profs ?? []).map((p: any) => [p.id, p.display_name ?? p.username ?? undefined]));
    const p: any = post;
    const when = p.event_date
      ? new Date(p.event_date).toLocaleString("en-US", {
          weekday: "short", month: "short", day: "numeric", year: "numeric",
          hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short",
        })
      : undefined;
    const location = p.location ?? undefined;
    const mapsUrl = location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}` : undefined;
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    let sent = 0, skipped = 0, failed = 0;
    for (const r of rows) {
      const recipientId = r.registered_by ?? r.user_id;
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(recipientId);
      const email = u?.user?.email;
      if (!email) { skipped++; continue; }
      try {
        const res = await sendTemplateEmail("tryout-invite", email, {
          templateData: {
            playerName: names.get(r.user_id), teamName: p.teams?.name, title: p.title, kind: (p as any).kind, when, location, mapsUrl,
            tryoutUrl: `https://ballacity.com/tryouts/${p.id}`, byGuardian: recipientId !== r.user_id,
          },
          idempotencyKey: `tryout-invite-${r.id}`,
        });
        if (res.sent) sent++; else skipped++;
      } catch (e) {
        console.error("tryout invite send failed", e);
        failed++;
      }
    }
    return { sent, skipped, failed };
  });

/** Manager-only: email a printable roster (name, position, jersey) to each player's parent/guardian (or the player). */
export const emailRosterPrintout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ teamId: z.string().min(1), postId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: isManager } = await context.supabase.rpc("is_team_manager", { _team: data.teamId, _user: context.userId });
    if (!isManager) throw new Error("Only owners, managers and coaches can email the roster.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: post } = await supabaseAdmin
      .from("team_posts").select("id,title,event_date,location,team_id,teams!inner(name)")
      .eq("id", data.postId).eq("team_id", data.teamId).maybeSingle();
    if (!post) throw new Error("Tryout not found.");
    const { data: members } = await supabaseAdmin
      .from("team_members").select("user_id,jersey_number,position")
      .eq("team_id", data.teamId).order("jersey_number", { ascending: true, nullsFirst: false });
    const rows = members ?? [];
    if (!rows.length) return { sent: 0, skipped: 0, failed: 0 };
    const ids = rows.map((m) => m.user_id);
    const [{ data: profs }, { data: links }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id,display_name,username").in("id", ids),
      supabaseAdmin.from("guardian_links").select("parent_user_id,child_user_id")
        .in("child_user_id", ids).in("status", ["active", "verified"]),
    ]);
    const names = new Map((profs ?? []).map((p: any) => [p.id, p.display_name ?? p.username ?? "Player"]));
    const guardianOf = new Map((links ?? []).map((l: any) => [l.child_user_id, l.parent_user_id]));
    const p: any = post;
    const when = p.event_date
      ? new Date(p.event_date).toLocaleString("en-US", {
          weekday: "short", month: "short", day: "numeric", year: "numeric",
          hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short",
        })
      : undefined;
    const players = rows.map((m) => ({
      name: names.get(m.user_id) ?? "Player",
      position: m.position ?? undefined,
      jersey: m.jersey_number ?? null,
    }));
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    let sent = 0, skipped = 0, failed = 0;
    for (const m of rows) {
      const recipientId = guardianOf.get(m.user_id) ?? m.user_id;
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(recipientId);
      const email = u?.user?.email;
      if (!email) { skipped++; continue; }
      try {
        const res = await sendTemplateEmail("team-roster-print", email, {
          templateData: {
            teamName: p.teams?.name, tryoutTitle: p.title, when,
            location: p.location ?? undefined, players,
          },
          idempotencyKey: `roster-print-${p.id}-${recipientId}`,
        });
        if (res.sent) sent++; else skipped++;
      } catch (e) {
        console.error("roster printout send failed", e);
        failed++;
      }
    }
    return { sent, skipped, failed };
  });

/** Manager-only: roster with birth year/position plus tryout ranking for every member and applicant. */
export const getRosterBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ teamId: z.string().min(1) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: isManager } = await context.supabase.rpc("is_team_manager", { _team: data.teamId, _user: context.userId });
    if (!isManager) throw new Error("Only owners, managers and coaches can view this.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [members, details, rsvps, evals, posts] = await Promise.all([
      supabaseAdmin.from("team_members").select("user_id,role,jersey_number,position").eq("team_id", data.teamId),
      context.supabase.from("team_roster_details").select("user_id,birth_year").eq("team_id", data.teamId),
      supabaseAdmin.from("tryout_rsvps").select("id,user_id,post_id").eq("team_id", data.teamId).eq("status", "registered"),
      context.supabase.from("tryout_evaluations").select("rsvp_id,attended,score").eq("team_id", data.teamId),
      supabaseAdmin.from("team_posts").select("id,title,event_date,location").eq("team_id", data.teamId).eq("kind", "tryout"),
    ]);
    const postTitle = new Map((posts.data ?? []).map((p) => [p.id, p.title]));
    const ev = new Map((evals.data ?? []).map((e: any) => [e.rsvp_id, e]));
    const best = new Map<string, { score: number | null; attended: boolean; tryout: string }>();
    for (const r of rsvps.data ?? []) {
      const e: any = ev.get(r.id);
      const cur = best.get(r.user_id);
      const score = (e?.score ?? null) as number | null;
      if (!cur || (score ?? -1) > (cur.score ?? -1)) best.set(r.user_id, { score, attended: !!e?.attended, tryout: postTitle.get(r.post_id) ?? "Tryout" });
    }
    const memberIds = (members.data ?? []).map((m) => m.user_id);
    const ids = [...new Set([...memberIds, ...best.keys()])];
    const { data: profs } = ids.length
      ? await supabaseAdmin.from("profiles").select("id,display_name,username,avatar_url").in("id", ids)
      : { data: [] as any[] };
    const prof = new Map((profs ?? []).map((p: any) => [p.id, p]));
    const by = new Map((details.data ?? []).map((d: any) => [d.user_id, d.birth_year as number | null]));
    const person = (id: string) => {
      const p: any = prof.get(id);
      return { userId: id, name: p?.display_name ?? p?.username ?? "Player", avatar: (p?.avatar_url ?? null) as string | null, tryout: best.get(id) ?? null };
    };
    const memberSet = new Set(memberIds);
    const upcomingTryout = (posts.data ?? [])
      .filter((t: any) => t.event_date && new Date(t.event_date).getTime() >= Date.now())
      .sort((a: any, b: any) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())[0] ?? null;
    return {
      upcomingTryout: upcomingTryout ? { id: (upcomingTryout as any).id as string, title: (upcomingTryout as any).title as string } : null,
      members: (members.data ?? []).map((m) => ({
        ...person(m.user_id), role: m.role as string, jersey: m.jersey_number, position: m.position ?? "", birthYear: by.get(m.user_id) ?? null,
      })),
      prospects: [...best.keys()].filter((id) => !memberSet.has(id)).map(person)
        .sort((a, b) => (b.tryout?.score ?? -1) - (a.tryout?.score ?? -1)),
    };
  });

export const saveRosterDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    teamId: z.string().min(1), userId: z.string().uuid(),
    birthYear: z.number().int().min(1940).max(2030).nullable(), position: z.string().trim().max(40),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: isManager } = await context.supabase.rpc("is_team_manager", { _team: data.teamId, _user: context.userId });
    if (!isManager) return { ok: false as const, error: "Only team managers can edit the roster." };
    const { error } = await context.supabase.from("team_roster_details").upsert({
      team_id: data.teamId, user_id: data.userId, birth_year: data.birthYear, updated_by: context.userId, updated_at: new Date().toISOString(),
    });
    if (error) return { ok: false as const, error: "Couldn't save birth year." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: e2 } = await supabaseAdmin.from("team_members").update({ position: data.position || null })
      .eq("team_id", data.teamId).eq("user_id", data.userId);
    if (e2) return { ok: false as const, error: "Couldn't save position." };
    return { ok: true as const };
  });

/** Manager-only: email a tryout link to a parent who may not have a BallaCity account yet. */
export const inviteParentToTryout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      teamId: z.string().min(1),
      postId: z.string().uuid(),
      email: z.string().trim().toLowerCase().email().max(254),
      parentName: z.string().trim().max(80).optional(),
      childName: z.string().trim().max(80).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: isManager } = await context.supabase.rpc("is_team_manager", { _team: data.teamId, _user: context.userId });
    if (!isManager) return { ok: false as const, error: "Only owners, managers and coaches can send invites." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: post } = await supabaseAdmin
      .from("team_posts").select("id,kind,title,event_date,location,teams!inner(name)")
      .eq("id", data.postId).eq("team_id", data.teamId).in("kind", ["tryout", "clinic"]).maybeSingle();
    if (!post) return { ok: false as const, error: "Tryout not found." };
    const p: any = post;
    const { data: me } = await supabaseAdmin.from("profiles").select("display_name,username").eq("id", context.userId).maybeSingle();
    const when = p.event_date
      ? new Date(p.event_date).toLocaleString("en-US", {
          weekday: "short", month: "short", day: "numeric", year: "numeric",
          hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short",
        })
      : undefined;
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    try {
      const res = await sendTemplateEmail("tryout-parent-invite", data.email, {
        templateData: {
          parentName: data.parentName || undefined, childName: data.childName || undefined,
          teamName: p.teams?.name, title: p.title, when, location: p.location ?? undefined,
          tryoutUrl: `https://ballacity.com/tryouts/${p.id}`,
          inviterName: (me as any)?.display_name ?? (me as any)?.username ?? undefined,
        },
        idempotencyKey: `tryout-parent-invite-${p.id}-${data.email}`,
      });
      return { ok: true as const, sent: !!res.sent };
    } catch (e) {
      console.error("parent tryout invite failed", e);
      return { ok: false as const, error: "Couldn't send the email. Try again." };
    }
  });

/** Manager-only: read whether scores/notes are shared with players & parents for a tryout. */
export const getTryoutSharing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ teamId: z.string().min(1), postId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: isManager } = await context.supabase.rpc("is_team_manager", { _team: data.teamId, _user: context.userId });
    if (!isManager) throw new Error("Only owners, managers and coaches can view this.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p } = await supabaseAdmin.from("team_posts").select("share_scores,share_notes")
      .eq("id", data.postId).eq("team_id", data.teamId).maybeSingle();
    return { shareScores: p?.share_scores ?? true, shareNotes: p?.share_notes ?? false };
  });

export const setTryoutSharing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    teamId: z.string().min(1), postId: z.string().uuid(),
    shareScores: z.boolean().optional(), shareNotes: z.boolean().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: isManager } = await context.supabase.rpc("is_team_manager", { _team: data.teamId, _user: context.userId });
    if (!isManager) throw new Error("Only owners, managers and coaches can change this.");
    const patch: { share_scores?: boolean; share_notes?: boolean } = {};
    if (data.shareScores !== undefined) patch.share_scores = data.shareScores;
    if (data.shareNotes !== undefined) patch.share_notes = data.shareNotes;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("team_posts").update(patch).eq("id", data.postId).eq("team_id", data.teamId);
    if (error) throw new Error("Couldn't save sharing settings.");
    return { ok: true };
  });

/** The caller's own result for a tryout, stripped per the team's sharing settings. */
export const getMyTryoutResult = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ postId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r } = await supabaseAdmin.from("tryout_rsvps").select("id")
      .eq("post_id", data.postId).eq("user_id", context.userId).eq("status", "registered").maybeSingle();
    if (!r) return null;
    const [{ data: p }, { data: e }] = await Promise.all([
      supabaseAdmin.from("team_posts").select("share_scores,share_notes").eq("id", data.postId).maybeSingle(),
      supabaseAdmin.from("tryout_evaluations").select("attended,score,notes").eq("rsvp_id", r.id).maybeSingle(),
    ]);
    return {
      attended: (e?.attended ?? null) as boolean | null,
      score: p?.share_scores ? ((e?.score ?? null) as number | null) : null,
      notes: p?.share_notes ? ((e?.notes || null) as string | null) : null,
      scoresShared: !!p?.share_scores,
      notesShared: !!p?.share_notes,
    };
  });

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
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

const handleRe = /^[a-z0-9_-]{3,40}$/;

export const listTrainerOrgs = createServerFn({ method: "GET" })
  .inputValidator((d: { search?: string } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const sb = publicClient();
    let q = sb
      .from("trainer_orgs")
      .select("id,name,handle,avatar,city,bio,verified,owner_id")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.search) q = q.ilike("name", `%${data.search}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getTrainerOrg = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: org, error } = await sb
      .from("trainer_orgs")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!org) return null;
    const { data: members } = await sb
      .from("trainer_org_members")
      .select("id,trainer_id,user_id,role,joined_at, teams:trainer_id(id,name,handle,avatar,city,sports)")
      .eq("org_id", data.id)
      .order("joined_at", { ascending: true });
    return { org, members: members ?? [] };
  });

export const createTrainerOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    name: string;
    handle: string;
    trainerId: string;
    bio?: string;
    city?: string;
    avatar?: string;
    website?: string;
    address?: string;
    placeId?: string;
    geo?: { lat: number; lng: number } | null;
  }) =>
    z
      .object({
        name: z.string().min(2).max(120),
        handle: z.string().min(3).max(40).regex(handleRe, "3–40 chars, a–z, 0–9, - or _"),
        trainerId: z.string().min(1),
        bio: z.string().max(2000).optional(),
        city: z.string().max(120).optional(),
        avatar: z.string().max(10).optional(),
        website: z.string().url().max(300).optional(),
        address: z.string().max(300).optional(),
        placeId: z.string().max(200).optional(),
        geo: z
          .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
          .nullable()
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("create_trainer_org_with_owner", {
      _name: data.name,
      _handle: data.handle,
      _trainer_id: data.trainerId,
      _bio: data.bio ?? undefined,
      _avatar: data.avatar ?? undefined,
      _city: data.city ?? undefined,
      _website: data.website ?? undefined,
      _address: data.address ?? undefined,
      _place_id: data.placeId ?? undefined,
      _geo: data.geo ?? undefined,
    });
    if (error) throw new Error(error.message);
    return id as string;
  });


export const listMyTrainerOrgMemberships = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { trainerId?: string } | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("trainer_org_members")
      .select("id,org_id,trainer_id,role,joined_at, org:org_id(id,name,handle,avatar,city,verified)")
      .eq("user_id", context.userId);
    if (data.trainerId) q = q.eq("trainer_id", data.trainerId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listInvitesForTrainer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { trainerId: string }) => z.object({ trainerId: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("trainer_org_invites")
      .select("id,org_id,role,status,message,created_at, org:org_id(id,name,handle,avatar,city)")
      .eq("invited_trainer_id", data.trainerId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const respondToTrainerOrgInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { inviteId: string; action: "accept" | "decline" }) =>
    z.object({ inviteId: z.string().uuid(), action: z.enum(["accept", "decline"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.action === "accept") {
      const { error } = await context.supabase.rpc("accept_trainer_org_invite", { _invite: data.inviteId });
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await context.supabase
      .from("trainer_org_invites")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("id", data.inviteId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const requestToJoinTrainerOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string; trainerId: string; message?: string }) =>
    z
      .object({
        orgId: z.string().uuid(),
        trainerId: z.string().min(1),
        message: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("trainer_org_join_requests").insert({
      org_id: data.orgId,
      trainer_id: data.trainerId,
      requested_by: context.userId,
      message: data.message ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listJoinRequestsForOrg = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("trainer_org_join_requests")
      .select("id,trainer_id,requested_by,message,status,created_at, trainer:trainer_id(id,name,handle,avatar,city)")
      .eq("org_id", data.orgId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const reviewJoinRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; action: "approve" | "reject"; notes?: string }) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["approve", "reject"]),
        notes: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.action === "approve") {
      const { error } = await context.supabase.rpc("approve_trainer_org_join", { _req: data.id });
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await context.supabase
      .from("trainer_org_join_requests")
      .update({
        status: "rejected",
        reviewer_notes: data.notes ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const inviteTrainerToOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string; trainerId: string; role?: "member" | "admin"; message?: string }) =>
    z
      .object({
        orgId: z.string().uuid(),
        trainerId: z.string().min(1),
        role: z.enum(["member", "admin"]).default("member"),
        message: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Look up the trainer profile owner
    const { data: t, error: tErr } = await context.supabase
      .from("teams")
      .select("id,owner_id,kind")
      .eq("id", data.trainerId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!t || t.kind !== "coach") throw new Error("Trainer profile not found");
    const { error } = await context.supabase.from("trainer_org_invites").insert({
      org_id: data.orgId,
      invited_trainer_id: data.trainerId,
      invited_user_id: t.owner_id,
      invited_by: context.userId,
      role: data.role ?? "member",
      message: data.message ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const leaveTrainerOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string; trainerId: string }) =>
    z.object({ orgId: z.string().uuid(), trainerId: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("trainer_org_members")
      .delete()
      .eq("org_id", data.orgId)
      .eq("trainer_id", data.trainerId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getTrainerOrgForTrainer = createServerFn({ method: "GET" })
  .inputValidator((d: { trainerId: string }) => z.object({ trainerId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: row, error } = await sb
      .from("trainer_org_members")
      .select("role, org:org_id(id,name,handle,avatar,city,verified)")
      .eq("trainer_id", data.trainerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const listTrainerIdsForOrg = createServerFn({ method: "GET" })
  .inputValidator((d: { orgId: string }) => z.object({ orgId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: rows, error } = await sb
      .from("trainer_org_members")
      .select("trainer_id")
      .eq("org_id", data.orgId);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => r.trainer_id as string);
  });

export const listMyTrainerProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("teams")
      .select("id,name,handle,avatar")
      .eq("owner_id", context.userId)
      .eq("kind", "coach");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getMyJoinRequestsForOrg = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("trainer_org_join_requests")
      .select("id,trainer_id,status,created_at")
      .eq("org_id", data.orgId)
      .eq("requested_by", context.userId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// -----------------------------------------------------------------------
// Standalone org create / update / member management
// -----------------------------------------------------------------------

const geoSchema = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
  .nullable()
  .optional();

export const createStandaloneOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    name: string;
    handle: string;
    bio?: string;
    city?: string;
    avatar?: string;
    avatarUrl?: string;
    coverUrl?: string;
    website?: string;
    address?: string;
    placeId?: string;
    geo?: { lat: number; lng: number } | null;
  }) =>
    z
      .object({
        name: z.string().min(2).max(120),
        handle: z.string().min(3).max(40).regex(handleRe, "3–40 chars, a–z, 0–9, - or _"),
        bio: z.string().max(2000).optional(),
        city: z.string().max(120).optional(),
        avatar: z.string().max(10).optional(),
        avatarUrl: z.string().url().max(1000).optional(),
        coverUrl: z.string().url().max(1000).optional(),
        website: z.string().url().max(300).optional(),
        address: z.string().max(300).optional(),
        placeId: z.string().max(200).optional(),
        geo: geoSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("trainer_orgs")
      .insert({
        owner_id: context.userId,
        name: data.name,
        handle: data.handle,
        bio: data.bio ?? null,
        city: data.city ?? null,
        avatar: data.avatar ?? null,
        avatar_url: data.avatarUrl ?? null,
        cover_url: data.coverUrl ?? null,
        website: data.website ?? null,
        address: data.address ?? null,
        place_id: data.placeId ?? null,
        geo: data.geo ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Best-effort: if caller owns any trainer profiles, seed the first one as
    // an owner member so the roster and manage view stay consistent.
    const { data: myTrainers } = await context.supabase
      .from("teams")
      .select("id")
      .eq("owner_id", context.userId)
      .eq("kind", "coach")
      .limit(1);
    const seed = myTrainers?.[0]?.id;
    if (seed) {
      await context.supabase
        .from("trainer_org_members")
        .insert({ org_id: row.id, trainer_id: seed, user_id: context.userId, role: "owner" })
        .then(() => undefined, () => undefined);
    }

    return row.id as string;
  });

export const updateTrainerOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id: string;
    name?: string;
    handle?: string;
    bio?: string | null;
    city?: string | null;
    website?: string | null;
    avatar?: string | null;
    avatarUrl?: string | null;
    coverUrl?: string | null;
    address?: string | null;
    placeId?: string | null;
    geo?: { lat: number; lng: number } | null;
  }) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(2).max(120).optional(),
        handle: z.string().min(3).max(40).regex(handleRe).optional(),
        bio: z.string().max(2000).nullable().optional(),
        city: z.string().max(120).nullable().optional(),
        website: z.string().url().max(300).nullable().optional(),
        avatar: z.string().max(10).nullable().optional(),
        avatarUrl: z.string().url().max(1000).nullable().optional(),
        coverUrl: z.string().url().max(1000).nullable().optional(),
        address: z.string().max(300).nullable().optional(),
        placeId: z.string().max(200).nullable().optional(),
        geo: geoSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Database["public"]["Tables"]["trainer_orgs"]["Update"] = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.handle !== undefined) patch.handle = data.handle;
    if (data.bio !== undefined) patch.bio = data.bio;
    if (data.city !== undefined) patch.city = data.city;
    if (data.website !== undefined) patch.website = data.website;
    if (data.avatar !== undefined) patch.avatar = data.avatar;
    if (data.avatarUrl !== undefined) patch.avatar_url = data.avatarUrl;
    if (data.coverUrl !== undefined) patch.cover_url = data.coverUrl;
    if (data.address !== undefined) patch.address = data.address;
    if (data.placeId !== undefined) patch.place_id = data.placeId;
    if (data.geo !== undefined) patch.geo = data.geo ?? null;
    const { error } = await context.supabase
      .from("trainer_orgs")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setOrgMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string; trainerId: string; role: "owner" | "admin" | "member" }) =>
    z
      .object({
        orgId: z.string().uuid(),
        trainerId: z.string().min(1),
        role: z.enum(["owner", "admin", "member"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Owner-only for owner-role changes; enforce last-owner safety.
    const { data: org } = await context.supabase
      .from("trainer_orgs")
      .select("owner_id")
      .eq("id", data.orgId)
      .maybeSingle();
    if (!org) throw new Error("Organization not found");
    if (data.role === "owner" && org.owner_id !== context.userId) {
      throw new Error("Only the owner can promote to owner.");
    }
    if (data.role !== "owner") {
      const { data: current } = await context.supabase
        .from("trainer_org_members")
        .select("role")
        .eq("org_id", data.orgId)
        .eq("trainer_id", data.trainerId)
        .maybeSingle();
      if (current?.role === "owner") {
        const { count } = await context.supabase
          .from("trainer_org_members")
          .select("id", { count: "exact", head: true })
          .eq("org_id", data.orgId)
          .eq("role", "owner");
        if ((count ?? 0) <= 1) {
          throw new Error("Cannot demote the last owner.");
        }
      }
    }
    const { error } = await context.supabase
      .from("trainer_org_members")
      .update({ role: data.role })
      .eq("org_id", data.orgId)
      .eq("trainer_id", data.trainerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeOrgMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string; trainerId: string }) =>
    z.object({ orgId: z.string().uuid(), trainerId: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: target } = await context.supabase
      .from("trainer_org_members")
      .select("role")
      .eq("org_id", data.orgId)
      .eq("trainer_id", data.trainerId)
      .maybeSingle();
    if (target?.role === "owner") {
      throw new Error("Transfer ownership before removing the owner.");
    }
    const { error } = await context.supabase
      .from("trainer_org_members")
      .delete()
      .eq("org_id", data.orgId)
      .eq("trainer_id", data.trainerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTrainerOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("trainer_orgs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// Generic (non-trainer) org membership
// ============================================================

export const listOrgMembers = createServerFn({ method: "GET" })
  .inputValidator((d: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: rows, error } = await sb
      .from("org_members")
      .select("id, org_id, user_id, role, created_at")
      .eq("org_id", data.orgId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    let profiles: Array<{ id: string; display_name: string | null; avatar_initials: string | null; avatar_url: string | null }> = [];
    if (userIds.length > 0) {
      const { data: profs } = await sb
        .from("profiles")
        .select("id, display_name, avatar_initials, avatar_url")
        .in("id", userIds);
      profiles = profs ?? [];
    }
    const map = new Map(profiles.map((p) => [p.id, p]));
    return (rows ?? []).map((r) => ({ ...r, profile: map.get(r.user_id) ?? null }));
  });

export const requestOrgMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string; message?: string }) =>
    z.object({ orgId: z.string().uuid(), message: z.string().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("org_member_requests")
      .insert({ org_id: data.orgId, user_id: context.userId, message: data.message ?? null })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const withdrawOrgMemberRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("org_member_requests")
      .update({ status: "withdrawn" })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyOrgMemberRequest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("org_member_requests")
      .select("*")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return rows?.[0] ?? null;
  });

export const listOrgMemberRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("org_member_requests")
      .select("id, org_id, user_id, message, status, denial_reason, created_at")
      .eq("org_id", data.orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    let profiles: Array<{ id: string; display_name: string | null; avatar_initials: string | null; avatar_url: string | null }> = [];
    if (userIds.length > 0) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, display_name, avatar_initials, avatar_url")
        .in("id", userIds);
      profiles = profs ?? [];
    }
    const map = new Map(profiles.map((p) => [p.id, p]));
    return (rows ?? []).map((r) => ({ ...r, profile: map.get(r.user_id) ?? null }));
  });

export const approveOrgMemberRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("approve_org_member_request", { _req: data.id });
    if (error) throw new Error(error.message);
    return { memberId: res as unknown as string | null };
  });

export const denyOrgMemberRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; reason?: string }) =>
    z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("deny_org_member_request", {
      _req: data.id,
      _reason: data.reason ?? "",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeOrgMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string; userId: string }) =>
    z.object({ orgId: z.string().uuid(), userId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("org_members")
      .delete()
      .eq("org_id", data.orgId)
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const leaveOrgMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("org_members")
      .delete()
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

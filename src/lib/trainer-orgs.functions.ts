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

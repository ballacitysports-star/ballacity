import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAccountType } from "./account-type-guard";
import type { Database } from "@/integrations/supabase/types";
import { parseHours } from "./org-hours";
import { MAX_ORG_AMENITIES } from "./org-listing";
import {
  pickFeaturedTrainer,
  summarizeRatings,
  type FeaturedTrainer,
  type TrainerCandidate,
} from "./featured-trainer";
import {
  firstVisibleOrgLink,
  toPublicRoster,
  type PublicRosterMember,
  type RawRosterRow,
} from "./org-roster";

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

// Columns the public directory needs to render a facility card. All are
// anon-readable (phone/email are not — see ORG_PUBLIC_COLUMNS below).
const ORG_DIRECTORY_COLUMNS =
  "id,name,handle,avatar,avatar_url,cover_url,photos,city,address,bio,category,amenities,hours,timezone,website,verified,owner_id";

// Escape characters that are special inside an ilike pattern.
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export const listTrainerOrgs = createServerFn({ method: "GET" })
  .inputValidator((d: { search?: string; q?: string } | undefined) =>
    z
      .object({
        // `search` matches the name only (used by the org pickers); `q` is the
        // directory search and also matches city and street address.
        search: z.string().max(80).optional(),
        q: z.string().max(80).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const sb = publicClient();
    let query = sb
      .from("trainer_orgs")
      .select(ORG_DIRECTORY_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.search?.trim()) query = query.ilike("name", likePattern(data.search.trim()));
    if (data.q?.trim()) {
      // Commas, parentheses and quotes are separators inside an or() group.
      const pat = likePattern(data.q.trim()).replace(/[,()"]/g, " ");
      query = query.or(`name.ilike.${pat},city.ilike.${pat},address.ilike.${pat}`);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/**
 * The real trainer to spotlight on the landing page: a claimed, bookable
 * trainer who is a member of a facility, preferring basketball / multi-sport.
 * Returns null when nobody qualifies (the page then shows a labeled example).
 *
 * `trainer_org_members` is not readable by anonymous visitors (it carries user
 * ids), so the link is read with the service role. Because that bypasses RLS,
 * the public-visibility rules are applied explicitly here (hidden trainers and
 * facilities, private/flagged reviews) and the result carries no user ids.
 */
export const getFeaturedFacilityTrainer = createServerFn({ method: "GET" }).handler(
  async (): Promise<FeaturedTrainer | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: links, error } = await supabaseAdmin
      .from("trainer_org_members")
      .select(
        "trainer_id, org:org_id(id,name,city,hidden_at), teams:trainer_id(id,kind,owner_id,name,avatar,city,sports,verified,rate_per_hour,session_types,tagline,bio,availability_slots,availability_rules,hidden_at)",
      )
      .limit(200);
    if (error) throw new Error(error.message);

    type Row = {
      org: { id: string; name: string; city: string | null; hidden_at: string | null } | null;
      teams: {
        id: string;
        kind: string | null;
        owner_id: string | null;
        name: string;
        avatar: string | null;
        city: string | null;
        sports: string[] | null;
        verified: boolean | null;
        rate_per_hour: number | null;
        session_types: string[] | null;
        tagline: string | null;
        bio: string | null;
        availability_slots: unknown;
        availability_rules: unknown;
        hidden_at: string | null;
      } | null;
    };
    const candidates: TrainerCandidate[] = [];
    for (const row of (links ?? []) as unknown as Row[]) {
      const t = row.teams;
      if (!t || t.hidden_at || !row.org || row.org.hidden_at) continue;
      candidates.push({
        id: t.id,
        kind: t.kind,
        ownerId: t.owner_id,
        name: t.name,
        avatar: t.avatar,
        city: t.city,
        sports: t.sports ?? [],
        verified: !!t.verified,
        ratePerHour: t.rate_per_hour,
        sessionTypes: t.session_types ?? [],
        tagline: t.tagline,
        bio: t.bio,
        availabilitySlots: t.availability_slots,
        availabilityRules: t.availability_rules,
        facility: { id: row.org.id, name: row.org.name, city: row.org.city },
      });
    }
    if (candidates.length === 0) return null;

    const { data: reviews } = await supabaseAdmin
      .from("reviews")
      .select("reviewee_id, rating")
      .eq("reviewee_kind", "trainer")
      .eq("is_private", false)
      .eq("flagged", false)
      .in(
        "reviewee_id",
        candidates.map((c) => c.id),
      );
    return pickFeaturedTrainer(candidates, summarizeRatings(reviews ?? []));
  },
);

export const listMyOrgs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trainer_orgs")
      .select("id, name, handle, avatar")
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; name: string; handle: string; avatar: string | null }[];
  });

// Columns anonymous visitors may read. `phone`/`email` are deliberately absent:
// the database revokes them from the `anon` role so contact details cannot be
// scraped from every gym listing, so selecting "*" here would fail for guests.
const ORG_PUBLIC_COLUMNS =
  "id,owner_id,name,handle,bio,avatar,city,website,verified,created_at,updated_at,avatar_url,cover_url,address,place_id,geo,category,amenities,photos,hours,timezone";

/**
 * A facility's trainers for its public page. Reads `trainer_org_members` with
 * the service role (anonymous and non-member reads are blocked by RLS on
 * purpose, because the table carries user ids), so what comes back is limited
 * to public trainer fields: no user ids, and hidden trainer profiles are
 * dropped. Callers must have already confirmed the facility is publicly
 * visible.
 */
async function listPublicOrgRoster(orgId: string): Promise<PublicRosterMember[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("trainer_org_members")
    .select(
      "id,trainer_id,role,joined_at, teams:trainer_id(id,name,handle,avatar,city,sports,hidden_at)",
    )
    .eq("org_id", orgId)
    .order("joined_at", { ascending: true });
  if (error) throw new Error(error.message);
  return toPublicRoster((data ?? []) as unknown as RawRosterRow[]);
}

export const getTrainerOrg = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: org, error } = await sb
      .from("trainer_orgs")
      .select(ORG_PUBLIC_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!org) return null;
    // The roster is public on the gym page, but `trainer_org_members` is
    // locked down in the database (it holds user ids), so it is read here with
    // the service role and returned without them.
    const members = await listPublicOrgRoster(data.id);
    return { org, members };
  });

/**
 * The signed-in viewer's own standing at a facility. The public roster no
 * longer carries user ids, so the page asks this instead of searching the
 * roster for the viewer.
 */
export const getMyOrgAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error } = await context.supabase.rpc("is_trainer_org_admin", {
      _org: data.orgId,
      _user: context.userId,
    });
    if (error) throw new Error(error.message);
    // Own row only: RLS lets a user read their own membership.
    const { data: member, error: memberErr } = await context.supabase
      .from("org_members")
      .select("id")
      .eq("org_id", data.orgId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (memberErr) throw new Error(memberErr.message);
    return { isAdmin: !!isAdmin, isMember: !!member };
  });

// Contact details are only readable by signed-in users.
export const getTrainerOrgContact = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("trainer_orgs")
      .select("phone,email")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { phone: row?.phone ?? null, email: row?.email ?? null };
  });

// Pre-fill data for "Post an event" from a facility page. Only owners/admins
// get `canPost: true` (checked here and again by the `hosted_games` trigger),
// so a crafted `?orgId=` link cannot attach a game to someone else's facility.
export const getOrgEventContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: adminErr } = await context.supabase.rpc("is_trainer_org_admin", {
      _org: data.orgId,
      _user: context.userId,
    });
    if (adminErr) throw new Error(adminErr.message);
    if (!isAdmin) return { canPost: false as const, org: null };
    const { data: org, error } = await context.supabase
      .from("trainer_orgs")
      .select("id,name,address,city,geo,amenities")
      .eq("id", data.orgId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!org) return { canPost: false as const, org: null };
    const geo = org.geo as { lat?: number; lng?: number } | null;
    return {
      canPost: true as const,
      org: {
        id: org.id,
        name: org.name,
        address: org.address ?? org.city ?? "",
        lat: typeof geo?.lat === "number" ? geo.lat : null,
        lng: typeof geo?.lng === "number" ? geo.lng : null,
        amenities: ((org as { amenities?: string[] | null }).amenities ?? []) as string[],
      },
    };
  });

export const createTrainerOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
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
    await requireAccountType(context.supabase, context.userId, "gym");
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
      .select(
        "id,org_id,trainer_id,role,joined_at, org:org_id(id,name,handle,avatar,city,verified)",
      )
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
      const { error } = await context.supabase.rpc("accept_trainer_org_invite", {
        _invite: data.inviteId,
      });
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
    // Idempotent: reuse or reopen an existing request instead of erroring on the unique constraint.
    const { data: existing } = await context.supabase
      .from("trainer_org_join_requests")
      .select("id,status")
      .eq("org_id", data.orgId)
      .eq("trainer_id", data.trainerId)
      .in("status", ["pending", "approved", "rejected"])
      .limit(1)
      .maybeSingle();

    if (existing) {
      if (existing.status === "pending") return { ok: true, status: "pending" as const };
      if (existing.status === "approved") return { ok: true, status: "approved" as const };
      const { error: updErr } = await context.supabase
        .from("trainer_org_join_requests")
        .update({
          status: "pending",
          message: data.message ?? null,
          requested_by: context.userId,
          reviewed_at: null,
        })
        .eq("id", existing.id);
      if (updErr) throw new Error(updErr.message);
      return { ok: true, status: "pending" as const };
    }

    const { error } = await context.supabase.from("trainer_org_join_requests").insert({
      org_id: data.orgId,
      trainer_id: data.trainerId,
      requested_by: context.userId,
      message: data.message ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true, status: "pending" as const };
  });

export const listJoinRequestsForOrg = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string }) => z.object({ orgId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("trainer_org_join_requests")
      .select(
        "id,trainer_id,requested_by,message,status,created_at, trainer:trainer_id(id,name,handle,avatar,city)",
      )
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
  .inputValidator(
    (d: { orgId: string; trainerId: string; role?: "member" | "admin"; message?: string }) =>
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
    // An unclaimed trainer listing has no owner, so there is nobody to invite —
    // inviting one would write a null invitee and the invite could never be answered.
    if (!t.owner_id)
      throw new Error("That trainer profile is unclaimed. Ask them to claim it first.");
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
    // Service role: see listPublicOrgRoster. Hidden facilities are skipped and
    // no user ids are returned.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("trainer_org_members")
      .select("role, org:org_id(id,name,handle,avatar,city,verified,hidden_at)")
      .eq("trainer_id", data.trainerId)
      .order("joined_at", { ascending: true });
    if (error) throw new Error(error.message);
    return firstVisibleOrgLink(
      (rows ?? []) as unknown as Parameters<typeof firstVisibleOrgLink>[0],
    );
  });

export const listTrainerIdsForOrg = createServerFn({ method: "GET" })
  .inputValidator((d: { orgId: string }) => z.object({ orgId: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    // Only for publicly visible facilities (anonymous RLS hides removed ones).
    const sb = publicClient();
    const { data: org } = await sb
      .from("trainer_orgs")
      .select("id")
      .eq("id", data.orgId)
      .maybeSingle();
    if (!org) return [] as string[];
    const roster = await listPublicOrgRoster(data.orgId);
    return roster.map((m) => m.trainer_id);
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
  .inputValidator(
    (d: {
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
      phone?: string;
      email?: string;
      category?: string;
      amenities?: string[];
      photos?: string[];
      hours?: Record<string, unknown>;
      timezone?: string;
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
          phone: z.string().max(40).optional(),
          email: z.string().email().max(200).optional(),
          category: z.string().max(60).optional(),
          amenities: z.array(z.string().max(60)).max(MAX_ORG_AMENITIES).optional(),
          photos: z.array(z.string().url().max(1000)).max(12).optional(),
          hours: z.record(z.string(), z.unknown()).optional(),
          timezone: z.string().max(80).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAccountType(context.supabase, context.userId, "gym");
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
        phone: data.phone ?? null,
        email: data.email ?? null,
        category: data.category ?? null,
        amenities: data.amenities ?? [],
        photos: data.photos ?? [],
        hours: parseHours(data.hours ?? {}),
        timezone: data.timezone ?? null,
      } as never)
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
        .then(
          () => undefined,
          () => undefined,
        );
    }

    return row.id as string;
  });

export const updateTrainerOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
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
      phone?: string | null;
      email?: string | null;
      category?: string | null;
      amenities?: string[];
      photos?: string[];
      hours?: Record<string, unknown>;
      timezone?: string | null;
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
          phone: z.string().max(40).nullable().optional(),
          email: z.string().email().max(200).nullable().optional(),
          category: z.string().max(60).nullable().optional(),
          amenities: z.array(z.string().max(60)).max(MAX_ORG_AMENITIES).optional(),
          photos: z.array(z.string().url().max(1000)).max(12).optional(),
          hours: z.record(z.string(), z.unknown()).optional(),
          timezone: z.string().max(80).nullable().optional(),
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
    const extra = patch as Record<string, unknown>;
    if (data.phone !== undefined) extra.phone = data.phone;
    if (data.email !== undefined) extra.email = data.email;
    if (data.category !== undefined) extra.category = data.category;
    if (data.amenities !== undefined) extra.amenities = data.amenities;
    if (data.photos !== undefined) extra.photos = data.photos;
    if (data.hours !== undefined) extra.hours = parseHours(data.hours);
    if (data.timezone !== undefined) extra.timezone = data.timezone;
    const { error } = await context.supabase.from("trainer_orgs").update(patch).eq("id", data.id);
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
    if (!org) throw new Error("Gym not found");
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
    let profiles: Array<{
      id: string;
      display_name: string | null;
      avatar_initials: string | null;
      avatar_url: string | null;
    }> = [];
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
    let profiles: Array<{
      id: string;
      display_name: string | null;
      avatar_initials: string | null;
      avatar_url: string | null;
    }> = [];
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
    const { data: res, error } = await context.supabase.rpc("approve_org_member_request", {
      _req: data.id,
    });
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

export const setGenericOrgMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string; userId: string; role: "admin" | "member" }) =>
    z
      .object({
        orgId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(["admin", "member"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("org_members")
      .update({ role: data.role })
      .eq("org_id", data.orgId)
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeGenericOrgMember = createServerFn({ method: "POST" })
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

export const searchProfilesForInvite = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string; q: string }) =>
    z.object({ orgId: z.string().uuid(), q: z.string().min(1).max(80) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: adminErr } = await context.supabase.rpc("is_trainer_org_admin", {
      _org: data.orgId,
      _user: context.userId,
    });
    if (adminErr) throw new Error(adminErr.message);
    if (!isAdmin) throw new Error("Only owners or admins can perform this action.");

    const { data: existing, error: memErr } = await context.supabase
      .from("org_members")
      .select("user_id")
      .eq("org_id", data.orgId);
    if (memErr) throw new Error(memErr.message);
    const exclude = new Set<string>([context.userId, ...(existing ?? []).map((m) => m.user_id)]);

    const { data: rows, error } = await context.supabase
      .from("profiles")
      .select("id, display_name, avatar_initials, avatar_url")
      .ilike("display_name", `%${data.q}%`)
      .limit(20);
    if (error) throw new Error(error.message);
    return (rows ?? []).filter((r) => !exclude.has(r.id));
  });

export const addOrgMemberDirect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orgId: string; userId: string; role?: "admin" | "member" }) =>
    z
      .object({
        orgId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(["admin", "member"]).default("member"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: adminErr } = await context.supabase.rpc("is_trainer_org_admin", {
      _org: data.orgId,
      _user: context.userId,
    });
    if (adminErr) throw new Error(adminErr.message);
    if (!isAdmin) throw new Error("Only owners or admins can perform this action.");

    const { error } = await context.supabase
      .from("org_members")
      .insert({ org_id: data.orgId, user_id: data.userId, role: data.role });
    if (error && !/duplicate key|unique/i.test(error.message)) throw new Error(error.message);

    const { data: org } = await context.supabase
      .from("trainer_orgs")
      .select("name")
      .eq("id", data.orgId)
      .maybeSingle();

    await context.supabase.from("notifications").insert({
      user_id: data.userId,
      type: "org_membership",
      title: `You were added to ${org?.name ?? "an organization"}`,
      body: "An admin added you as a member.",
      link: `/orgs/${data.orgId}`,
    });

    return { ok: true };
  });

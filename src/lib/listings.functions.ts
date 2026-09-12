import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertModerator } from "@/lib/moderation.server";
import { getAdmin, writeAudit } from "@/lib/superadmin.server";

export type ListingSubjectType = "team" | "gym";

/**
 * `listing_claims` and the listing RPCs are newer than the checked-in generated
 * types, so they are reached through an untyped handle — the same escape hatch
 * `transfer_team_ownership` already uses. Regenerating types will not break this.
 */
const untyped = (client: unknown) => client as any;

export type UnclaimedListing = {
  subjectType: ListingSubjectType;
  id: string;
  name: string;
  handle: string | null;
  city: string | null;
  listedAt: string | null;
  createdAt: string;
  pendingClaims: number;
};

export type PendingClaim = {
  id: string;
  subjectType: ListingSubjectType;
  subjectId: string;
  subjectName: string;
  userId: string;
  claimantName: string;
  message: string | null;
  evidenceUrl: string | null;
  createdAt: string;
};

const SUBJECT = z.enum(["team", "gym"]);

export const listingsCheck = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("is_moderator", {
      _user_id: context.userId,
    });
    return { isModerator: !!data, userId: context.userId };
  });

export const listUnclaimedListings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string } | undefined) =>
    z.object({ search: z.string().max(120).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<UnclaimedListing[]> => {
    await assertModerator(context);
    const admin = await getAdmin();
    const search = (data.search ?? "").trim();
    const like = `%${search.replace(/[%_]/g, (m) => `\\${m}`)}%`;

    let teamQ = admin
      .from("teams")
      .select("id, name, handle, city, listed_at, created_at")
      .is("owner_id", null)
      .order("created_at", { ascending: false })
      .limit(100);
    let gymQ = admin
      .from("trainer_orgs")
      .select("id, name, handle, city, listed_at, created_at")
      .is("owner_id", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (search) {
      teamQ = teamQ.or(`name.ilike.${like},handle.ilike.${like},city.ilike.${like}`);
      gymQ = gymQ.or(`name.ilike.${like},handle.ilike.${like},city.ilike.${like}`);
    }

    const [teams, gyms, claims] = await Promise.all([
      teamQ,
      gymQ,
      untyped(admin)
        .from("listing_claims")
        .select("subject_type, subject_id")
        .eq("status", "pending"),
    ]);

    const pending = new Map<string, number>();
    for (const c of (claims.data ?? []) as any[]) {
      const key = `${c.subject_type}:${c.subject_id}`;
      pending.set(key, (pending.get(key) ?? 0) + 1);
    }

    const shape = (rows: any[], subjectType: ListingSubjectType): UnclaimedListing[] =>
      rows.map((r) => ({
        subjectType,
        id: String(r.id),
        name: r.name,
        handle: r.handle ?? null,
        city: r.city ?? null,
        listedAt: r.listed_at ?? null,
        createdAt: r.created_at,
        pendingClaims: pending.get(`${subjectType}:${r.id}`) ?? 0,
      }));

    return [...shape(teams.data ?? [], "team"), ...shape(gyms.data ?? [], "gym")].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  });

export const createUnclaimedListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      subjectType: ListingSubjectType;
      name: string;
      handle: string;
      city?: string;
      kind?: "team" | "coach";
      sports?: string[];
      category?: string;
      address?: string;
      website?: string;
    }) =>
      z
        .object({
          subjectType: SUBJECT,
          name: z.string().trim().min(2).max(120),
          handle: z.string().trim().min(2).max(60),
          city: z.string().trim().max(120).optional(),
          kind: z.enum(["team", "coach"]).optional(),
          sports: z.array(z.string().trim().max(40)).max(10).optional(),
          category: z.string().trim().max(60).optional(),
          address: z.string().trim().max(240).optional(),
          website: z.string().trim().max(240).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertModerator(context);

    // Called with the moderator's own client, not the admin one: the RPCs read
    // auth.uid() to authorise and to stamp listed_by.
    const rpc = untyped(context.supabase).rpc.bind(context.supabase) as (
      n: string,
      a: Record<string, unknown>,
    ) => Promise<any>;
    let id: string;

    if (data.subjectType === "team") {
      const slug =
        data.handle
          .replace(/^@/, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || crypto.randomUUID();
      const { data: out, error } = await rpc("create_unclaimed_team", {
        _id: slug,
        _kind: data.kind ?? "team",
        _name: data.name,
        _handle: data.handle,
        _city: data.city ?? "",
        _sports: data.sports ?? [],
      });
      if (error) throw new Error(error.message);
      id = String(out);
    } else {
      const { data: out, error } = await rpc("create_unclaimed_gym", {
        _name: data.name,
        _handle: data.handle,
        _city: data.city ?? null,
        _category: data.category ?? null,
        _address: data.address ?? null,
        _website: data.website ?? null,
      });
      if (error) throw new Error(error.message);
      id = String(out);
    }

    await writeAudit(await getAdmin(), context.userId, {
      action: "listing.create_unclaimed",
      targetType: data.subjectType === "team" ? "team" : "org",
      targetId: id,
      after: { name: data.name, handle: data.handle, city: data.city ?? null, ownerId: null },
    });

    return { id, subjectType: data.subjectType };
  });

export const listPendingClaims = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PendingClaim[]> => {
    await assertModerator(context);
    const admin = await getAdmin();

    const { data: claims } = await untyped(admin)
      .from("listing_claims")
      .select("id, subject_type, subject_id, user_id, message, evidence_url, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(200);
    const rows: any[] = claims ?? [];
    if (!rows.length) return [];

    const teamIds = rows.filter((r) => r.subject_type === "team").map((r) => r.subject_id);
    const gymIds = rows.filter((r) => r.subject_type === "gym").map((r) => r.subject_id);
    const [teams, gyms, profiles] = await Promise.all([
      teamIds.length
        ? admin.from("teams").select("id, name").in("id", teamIds)
        : Promise.resolve({ data: [] as any[] }),
      gymIds.length
        ? admin.from("trainer_orgs").select("id, name").in("id", gymIds)
        : Promise.resolve({ data: [] as any[] }),
      admin
        .from("profiles")
        .select("id, display_name, username")
        .in("id", [...new Set(rows.map((r) => r.user_id))]),
    ]);

    const names = new Map<string, string>();
    for (const t of teams.data ?? []) names.set(`team:${t.id}`, t.name);
    for (const g of gyms.data ?? []) names.set(`gym:${g.id}`, g.name);
    const people = new Map<string, string>();
    for (const p of profiles.data ?? [])
      people.set(p.id, p.display_name || p.username || "Someone");

    return rows.map((r) => ({
      id: r.id,
      subjectType: r.subject_type as ListingSubjectType,
      subjectId: r.subject_id,
      subjectName: names.get(`${r.subject_type}:${r.subject_id}`) ?? "Deleted listing",
      userId: r.user_id,
      claimantName: people.get(r.user_id) ?? "Someone",
      message: r.message ?? null,
      evidenceUrl: r.evidence_url ?? null,
      createdAt: r.created_at,
    }));
  });

export const reviewClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { claimId: string; action: "approve" | "deny"; reason?: string }) =>
    z
      .object({
        claimId: z.string().uuid(),
        action: z.enum(["approve", "deny"]),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertModerator(context);
    const admin = await getAdmin();

    // Snapshot before the write so the audit entry records what actually changed.
    const { data: claim } = await untyped(admin)
      .from("listing_claims")
      .select("subject_type, subject_id, user_id")
      .eq("id", data.claimId)
      .maybeSingle();

    const rpc = untyped(context.supabase).rpc.bind(context.supabase) as (
      n: string,
      a: Record<string, unknown>,
    ) => Promise<any>;
    const { error } =
      data.action === "approve"
        ? await rpc("approve_listing_claim", { _claim: data.claimId })
        : await rpc("deny_listing_claim", { _claim: data.claimId, _reason: data.reason ?? null });
    if (error) throw new Error(error.message);

    await writeAudit(admin, context.userId, {
      action: data.action === "approve" ? "listing.claim_approve" : "listing.claim_deny",
      targetType: claim?.subject_type === "gym" ? "org" : "team",
      targetId: claim?.subject_id ?? null,
      reason: data.reason ?? null,
      before: { ownerId: null },
      after:
        data.action === "approve"
          ? { ownerId: claim?.user_id ?? null, claimId: data.claimId }
          : { ownerId: null, claimId: data.claimId },
    });

    return { ok: true };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSuperadmin, getAdmin, writeAudit } from "@/lib/superadmin.server";
import { IMAGE_BUCKET_KEYS } from "@/lib/image-moderation";

export const superadminListImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      buckets?: string[];
      search?: string;
      status?: string;
      limit?: number;
      offset?: number;
    }) =>
      z
        .object({
          buckets: z.array(z.string().max(60)).optional(),
          search: z.string().max(200).optional(),
          status: z.enum(["all", "pending", "kept", "quarantined", "removed"]).optional(),
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { imageObjectUrl } = await import("@/lib/image-moderation.server");

    const allowed = new Set<string>(IMAGE_BUCKET_KEYS);
    const requested = (data.buckets ?? []).filter((b) => allowed.has(b));
    const buckets = requested.length ? requested : IMAGE_BUCKET_KEYS;

    const { data: rows, error } = await context.supabase.rpc("admin_list_storage_objects", {
      _buckets: buckets,
      _search: data.search ?? undefined,
      _status: data.status ?? "pending",
      _limit: data.limit ?? 60,
      _offset: data.offset ?? 0,
    });
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as any[];
    const total = list.length > 0 ? Number(list[0].total ?? list.length) : 0;

    const ownerIds = Array.from(new Set(list.map((r) => r.owner).filter(Boolean))) as string[];
    const { data: owners } = ownerIds.length
      ? await admin
          .from("profiles")
          .select("id, display_name, username, suspended_at")
          .in("id", ownerIds)
      : { data: [] as any[] };
    const ownerMap = new Map((owners ?? []).map((o: any) => [o.id, o]));

    const images = await Promise.all(
      list.map(async (r) => ({
        bucket: r.bucket_id as string,
        path: r.name as string,
        url: await imageObjectUrl(admin, r.bucket_id, r.name),
        size: r.size ? Number(r.size) : null,
        mimetype: (r.mimetype as string) ?? null,
        createdAt: r.created_at as string,
        status: (r.status as string) ?? "pending",
        reason: (r.reason as string) ?? null,
        reviewedAt: (r.reviewed_at as string) ?? null,
        ownerId: (r.owner as string) ?? null,
        owner: r.owner ? (ownerMap.get(r.owner) ?? null) : null,
      })),
    );

    return { total, images };
  });

export const superadminReviewImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      bucket: string;
      path: string;
      action: string;
      reason?: string;
      suspendOwner?: boolean;
    }) =>
      z
        .object({
          bucket: z.string().max(60),
          path: z.string().min(1).max(500),
          action: z.enum(["keep", "quarantine", "remove", "reopen"]),
          reason: z.string().max(500).optional(),
          suspendOwner: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { clearImageReferences } = await import("@/lib/image-moderation.server");

    if (!IMAGE_BUCKET_KEYS.includes(data.bucket as any)) {
      throw new Error("Unsupported bucket");
    }
    const { bucket, path, action } = data;
    const reason = data.reason?.trim() || null;

    let ownerId: string | null = null;
    let removedRefs = 0;

    if (action === "remove") {
      const { data: objRows } = await context.supabase.rpc("admin_list_storage_objects", {
        _buckets: [bucket],
        _search: path,
        _status: "all",
        _limit: 1,
        _offset: 0,
      });
      ownerId = ((objRows as any[]) ?? [])[0]?.owner ?? null;

      removedRefs = await clearImageReferences(admin, bucket, path);

      const { error: delErr } = await admin.storage.from(bucket).remove([path]);
      if (delErr) throw new Error(delErr.message);

      if (data.suspendOwner && ownerId) {
        await admin
          .from("profiles")
          .update({
            suspended_at: new Date().toISOString(),
            suspended_reason: reason ?? "Abusive image upload",
          })
          .eq("id", ownerId);
      }
    }

    const status =
      action === "remove"
        ? "removed"
        : action === "keep"
          ? "kept"
          : action === "quarantine"
            ? "quarantined"
            : "pending";
    const { error: upErr } = await admin.from("image_moderation").upsert(
      {
        bucket,
        path,
        owner_id: ownerId,
        status,
        reason,
        reviewed_by: action === "reopen" ? null : context.userId,
        reviewed_at: action === "reopen" ? null : new Date().toISOString(),
        quarantined_at: action === "quarantine" ? new Date().toISOString() : null,
      },
      { onConflict: "bucket,path" },
    );
    if (upErr) throw new Error(upErr.message);

    await writeAudit(admin, context.userId, {
      action: `image_${action}`,
      targetType: "storage_object",
      targetId: `${bucket}/${path}`,
      reason,
      after: { status, removedRefs, suspendedOwner: !!data.suspendOwner },
    });

    return { ok: true, status, removedRefs };
  });

export const superadminImageStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { data } = await admin.from("image_moderation").select("status");
    const counts: Record<string, number> = { pending: 0, kept: 0, quarantined: 0, removed: 0 };
    (data ?? []).forEach((r: any) => {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    });
    return counts;
  });

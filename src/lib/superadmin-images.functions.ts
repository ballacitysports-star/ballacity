import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSuperadmin, getAdmin, writeAudit } from "@/lib/superadmin.server";

/** Buckets that hold user-uploaded imagery, and whether they are public. */
export const IMAGE_BUCKETS = {
  avatars: { public: true, label: "Player avatars" },
  covers: { public: true, label: "Player covers" },
  "org-avatars": { public: true, label: "Gym logos" },
  "org-covers": { public: true, label: "Gym covers & gallery" },
  "team-avatars": { public: true, label: "Team logos" },
  "team-covers": { public: true, label: "Team covers" },
  "trainer-avatars": { public: true, label: "Trainer avatars" },
  "game-covers": { public: false, label: "Game covers" },
} as const;

export type ImageBucketKey = keyof typeof IMAGE_BUCKETS;

const BUCKET_KEYS = Object.keys(IMAGE_BUCKETS) as ImageBucketKey[];

/** Columns that may reference an uploaded image URL, cleared when it is removed. */
const REFERENCES: Array<{ table: string; columns: string[]; jsonColumns?: string[] }> = [
  { table: "profiles", columns: ["avatar_url", "cover_url"] },
  { table: "teams", columns: ["avatar", "cover"] },
  { table: "trainer_orgs", columns: ["avatar", "avatar_url", "cover_url"], jsonColumns: ["photos"] },
  { table: "hosted_games", columns: ["image"] },
];

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
          buckets: z.array(z.enum(BUCKET_KEYS as [string, ...string[]])).optional(),
          search: z.string().max(200).optional(),
          status: z.enum(["all", "pending", "kept", "removed"]).optional(),
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const buckets = data.buckets?.length ? data.buckets : BUCKET_KEYS;
    const limit = data.limit ?? 60;
    const offset = data.offset ?? 0;

    const { data: rows, error } = await admin.rpc("admin_list_storage_objects", {
      _buckets: buckets,
      _search: data.search ?? null,
      _status: data.status ?? "pending",
      _limit: limit,
      _offset: offset,
    });
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as any[];
    const total = list.length > 0 ? Number(list[0].total ?? list.length) : 0;

    const ownerIds = Array.from(
      new Set(list.map((r) => r.owner).filter((v): v is string => !!v)),
    );
    const { data: owners } = ownerIds.length
      ? await admin
          .from("profiles")
          .select("id, display_name, username, suspended_at")
          .in("id", ownerIds)
      : { data: [] as any[] };
    const ownerMap = new Map((owners ?? []).map((o: any) => [o.id, o]));

    const images = await Promise.all(
      list.map(async (r) => {
        const isPublic = (IMAGE_BUCKETS as Record<string, { public: boolean }>)[r.bucket_id]
          ?.public;
        let url: string | null = null;
        if (isPublic) {
          url = admin.storage.from(r.bucket_id).getPublicUrl(r.name).data.publicUrl;
        } else {
          const { data: signed } = await admin.storage
            .from(r.bucket_id)
            .createSignedUrl(r.name, 60 * 60);
          url = signed?.signedUrl ?? null;
        }
        return {
          bucket: r.bucket_id as string,
          path: r.name as string,
          url,
          size: r.size ? Number(r.size) : null,
          mimetype: (r.mimetype as string) ?? null,
          createdAt: r.created_at as string,
          status: (r.status as string) ?? "pending",
          reason: (r.reason as string) ?? null,
          reviewedAt: (r.reviewed_at as string) ?? null,
          ownerId: (r.owner as string) ?? null,
          owner: r.owner ? (ownerMap.get(r.owner) ?? null) : null,
        };
      }),
    );

    return { total, images };
  });

export const superadminReviewImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { bucket: string; path: string; action: string; reason?: string; suspendOwner?: boolean }) =>
      z
        .object({
          bucket: z.enum(BUCKET_KEYS as [string, ...string[]]),
          path: z.string().min(1).max(500),
          action: z.enum(["keep", "remove", "reopen"]),
          reason: z.string().max(500).optional(),
          suspendOwner: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { bucket, path, action } = data;
    const reason = data.reason?.trim() || null;

    let ownerId: string | null = null;
    let removedRefs = 0;

    if (action === "remove") {
      const isPublic = (IMAGE_BUCKETS as Record<string, { public: boolean }>)[bucket]?.public;
      const url = isPublic
        ? admin.storage.from(bucket).getPublicUrl(path).data.publicUrl
        : null;

      // Clear DB references before the object disappears.
      const marker = `${bucket}/${path}`;
      for (const ref of REFERENCES) {
        for (const col of ref.columns) {
          const { data: hits } = await admin
            .from(ref.table)
            .select("id")
            .like(col, `%${marker}%`);
          if (hits?.length) {
            await admin
              .from(ref.table)
              .update({ [col]: null })
              .in(
                "id",
                hits.map((h: any) => h.id),
              );
            removedRefs += hits.length;
          }
        }
        for (const col of ref.jsonColumns ?? []) {
          const { data: rows } = await admin.from(ref.table).select(`id, ${col}`);
          for (const row of rows ?? []) {
            const arr = (row as any)[col];
            if (!Array.isArray(arr)) continue;
            const next = arr.filter(
              (item: any) =>
                !(typeof item === "string"
                  ? item.includes(marker)
                  : typeof item?.url === "string" && item.url.includes(marker)),
            );
            if (next.length !== arr.length) {
              await admin
                .from(ref.table)
                .update({ [col]: next })
                .eq("id", (row as any).id);
              removedRefs += 1;
            }
          }
        }
      }

      const { data: objOwner } = await admin.rpc("admin_list_storage_objects", {
        _buckets: [bucket],
        _search: path,
        _status: "all",
        _limit: 1,
        _offset: 0,
      });
      ownerId = (objOwner as any[])?.[0]?.owner ?? null;

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

      void url;
    }

    const status = action === "remove" ? "removed" : action === "keep" ? "kept" : "pending";
    const { error: upErr } = await admin.from("image_moderation").upsert(
      {
        bucket,
        path,
        owner_id: ownerId,
        status,
        reason,
        reviewed_by: action === "reopen" ? null : context.userId,
        reviewed_at: action === "reopen" ? null : new Date().toISOString(),
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
    const counts: Record<string, number> = { pending: 0, kept: 0, removed: 0 };
    (data ?? []).forEach((r: any) => {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    });
    return counts;
  });

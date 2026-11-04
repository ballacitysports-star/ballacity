import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSuperadmin, getAdmin, writeAudit } from "@/lib/superadmin.server";
import { IMAGE_BUCKET_KEYS } from "@/lib/image-moderation";
import { inspectImageMetadata } from "@/lib/image-metadata";

/**
 * Assess images that were stored before server-side metadata stripping existed.
 *
 * `superadminScanImageMetadata` is read-only: it downloads a page of stored images, looks for GPS, EXIF, XMP and other
 * personal tags, and returns COUNTS and the bucket/path of each image that has any. It never returns coordinates or
 * tag values. `superadminStripStoredImages` rewrites named images without the tags and defaults to a dry run.
 * Neither runs by itself; production use needs the owner's approval for the specific run.
 */
export const superadminScanImageMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { buckets?: string[]; limit?: number; offset?: number }) =>
    z
      .object({
        buckets: z.array(z.string().max(60)).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { addToScanCounts, emptyScanCounts } = await import("@/lib/image-metadata.server");
    const allowed = new Set<string>(IMAGE_BUCKET_KEYS);
    const requested = (data.buckets ?? []).filter((b) => allowed.has(b));
    const buckets = requested.length ? requested : IMAGE_BUCKET_KEYS;
    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;

    const { data: rows, error } = await context.supabase.rpc("admin_list_storage_objects", {
      _buckets: buckets,
      _status: "all",
      _limit: limit,
      _offset: offset,
    });
    if (error) throw new Error(error.message);

    const counts = emptyScanCounts();
    const flagged: { bucket: string; path: string; gps: boolean }[] = [];
    for (const r of (rows ?? []) as { bucket_id: string; name: string }[]) {
      let report = null;
      try {
        const { data: blob } = await admin.storage.from(r.bucket_id).download(r.name);
        if (blob) report = inspectImageMetadata(new Uint8Array(await blob.arrayBuffer()));
      } catch {
        report = null;
      }
      const any = addToScanCounts(counts, r.bucket_id, report);
      if (any && report) flagged.push({ bucket: r.bucket_id, path: r.name, gps: report.hasGps });
    }
    return {
      ...counts,
      flagged,
      nextOffset: (rows ?? []).length === limit ? offset + limit : null,
    };
  });

export const superadminStripStoredImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { items: { bucket: string; path: string }[]; dryRun?: boolean; reason?: string }) =>
      z
        .object({
          items: z
            .array(z.object({ bucket: z.string().max(60), path: z.string().min(1).max(500) }))
            .min(1)
            .max(50),
          dryRun: z.boolean().optional(),
          reason: z.string().max(500).optional(),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { stripStoredImage } = await import("@/lib/image-metadata.server");
    const { sniffImageMime } = await import("@/lib/image-validation");
    const dryRun = data.dryRun !== false; // a dry run unless explicitly turned off
    const allowed = new Set<string>(IMAGE_BUCKET_KEYS);

    const results: {
      bucket: string;
      path: string;
      status: "clean" | "would_strip" | "stripped" | "error";
    }[] = [];
    for (const it of data.items) {
      if (!allowed.has(it.bucket)) {
        results.push({ ...it, status: "error" });
        continue;
      }
      try {
        const { data: blob, error } = await admin.storage.from(it.bucket).download(it.path);
        if (error || !blob) throw new Error("unreadable");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mime = sniffImageMime(bytes);
        if (!mime) throw new Error("not an image");
        if (dryRun) {
          const { stripImageMetadata } = await import("@/lib/image-metadata");
          results.push({
            ...it,
            status: stripImageMetadata(bytes).changed ? "would_strip" : "clean",
          });
        } else {
          const out = await stripStoredImage(admin, it.bucket, it.path, bytes, mime);
          results.push({ ...it, status: out.rewritten ? "stripped" : "clean" });
        }
      } catch {
        results.push({ ...it, status: "error" });
      }
    }
    if (!dryRun) {
      await writeAudit(admin, context.userId, {
        action: "image_metadata_strip",
        targetType: "storage_objects",
        reason: data.reason ?? null,
        metadata: {
          requested: data.items.length,
          stripped: results.filter((r) => r.status === "stripped").length,
          errors: results.filter((r) => r.status === "error").length,
        },
      });
    }
    return { dryRun, results };
  });

/**
 * Remove stale files from the private `image-staging` bucket (abandoned uploads, failed publishes, held scans). Defaults to a dry run
 * and to files older than 24 hours. Not scheduled; running it for real is the superadmin's explicit action.
 */
export const superadminSweepImageStaging = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { olderThanHours?: number; dryRun?: boolean }) =>
    z
      .object({
        olderThanHours: z
          .number()
          .min(1)
          .max(24 * 30)
          .optional(),
        dryRun: z.boolean().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { sweepImageStaging } = await import("@/lib/image-promotion.server");
    const dryRun = data.dryRun ?? true;
    const result = await sweepImageStaging(admin, {
      olderThanMs: (data.olderThanHours ?? 24) * 3600 * 1000,
      dryRun,
    });
    if (!dryRun) {
      await writeAudit(admin, context.userId, {
        action: "image_staging_sweep",
        targetType: "storage_objects",
        metadata: { ...result },
      });
    }
    return { dryRun, ...result };
  });

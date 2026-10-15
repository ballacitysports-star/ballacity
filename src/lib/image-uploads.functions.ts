import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { IMAGE_BUCKET_KEYS } from "@/lib/image-moderation";
import {
  MAX_IMAGE_BYTES,
  readImageDimensions,
  sniffImageMime,
  validateImageMeta,
} from "@/lib/image-validation";

/**
 * Server-side gate for every uploaded image: re-validates type / size /
 * dimensions from the stored bytes (never trusting the client), then runs an
 * automated safety scan. Unsafe uploads are quarantined so nothing in the app
 * renders them until a superadmin approves.
 */
export const finalizeImageUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { bucket: string; path: string }) =>
    z.object({ bucket: z.string().max(60), path: z.string().min(1).max(500) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { bucket, path } = data;
    if (!(IMAGE_BUCKET_KEYS as string[]).includes(bucket)) {
      throw new Error("Unsupported bucket");
    }
    if (!path.startsWith(`${context.userId}/`)) {
      throw new Error("You can only finalize your own uploads");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { scanImageForSafety } = await import("@/lib/image-safety.server");

    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(bucket).download(path);
    if (dlErr || !blob) throw new Error("Uploaded file could not be read");

    const buffer = new Uint8Array(await blob.arrayBuffer());
    const bytes = buffer.byteLength;
    const sniffed = sniffImageMime(buffer);
    const dimensions = readImageDimensions(buffer);

    const failure =
      validateImageMeta({ mime: sniffed, bytes, dimensions }) ??
      (dimensions ? null : "The file is not a readable JPG, PNG or WEBP image");

    if (failure) {
      await supabaseAdmin.storage.from(bucket).remove([path]);
      await supabaseAdmin.from("image_moderation").upsert(
        {
          bucket,
          path,
          owner_id: context.userId,
          status: "removed",
          reason: failure,
          mime: sniffed,
          bytes,
          width: dimensions?.width ?? null,
          height: dimensions?.height ?? null,
          scan: { stage: "validation", failure } as never,
        },
        { onConflict: "bucket,path" },
      );
      throw new Error(failure);
    }

    // Small enough to inline: keeps private-bucket scans off signed URLs.
    const inlineable = bytes <= 4 * 1024 * 1024 && bytes <= MAX_IMAGE_BYTES;
    let scanTarget: string | null = null;
    if (inlineable) {
      let binary = "";
      for (let i = 0; i < buffer.length; i += 0x8000) {
        binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
      }
      scanTarget = `data:${sniffed};base64,${btoa(binary)}`;
    } else {
      const { imageObjectUrl } = await import("@/lib/image-moderation.server");
      scanTarget = await imageObjectUrl(supabaseAdmin, bucket, path);
    }

    const verdict = scanTarget
      ? await scanImageForSafety(scanTarget, { userId: context.userId })
      : {
          safe: true,
          label: "unscanned",
          reason: null,
          categories: [],
          scanned: false,
          csam: false,
        };

    const quarantined = !verdict.safe;
    const reason = quarantined
      ? (verdict.reason ?? `Flagged by automated scan (${verdict.label})`)
      : null;

    const { error: upErr } = await supabaseAdmin.from("image_moderation").upsert(
      {
        bucket,
        path,
        owner_id: context.userId,
        status: quarantined ? "quarantined" : "pending",
        reason,
        mime: sniffed,
        bytes,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        quarantined_at: quarantined ? new Date().toISOString() : null,
        scan: verdict as never,
      },
      { onConflict: "bucket,path" },
    );
    if (upErr) throw new Error(upErr.message);

    if (verdict.csam) {
      const { escalateImageForChildSafety } = await import("@/lib/ai/moderation.server");
      await escalateImageForChildSafety(supabaseAdmin, {
        bucket,
        path,
        categories: verdict.categories,
        source: "image_upload",
      });
    }

    return {
      ok: true,
      quarantined,
      reason,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      bytes,
      mime: sniffed,
    };
  });

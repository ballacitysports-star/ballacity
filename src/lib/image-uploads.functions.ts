import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * LEGACY server-side gate for an image an older client uploaded straight into a public bucket: re-validates type / size /
 * dimensions from the stored bytes (never trusting the client), strips metadata, then runs an automated safety scan. Unsafe
 * uploads are quarantined so nothing in the app renders them until a superadmin approves. It never rescans an object that is
 * already quarantined or removed, and removes the object when the scan cannot run (fail closed). Retired with phase 2
 * (docs/privacy/g3b-image-staging.md); new clients use promoteStagedImageUpload.
 */
export const finalizeImageUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { bucket: string; path: string }) =>
    z.object({ bucket: z.string().max(60), path: z.string().min(1).max(500) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { scanImageForSafety } = await import("@/lib/image-safety.server");
    const { imageObjectUrl } = await import("@/lib/image-moderation.server");
    const { escalateImageForChildSafety } = await import("@/lib/ai/moderation.server");
    const { finalizeDirectImageUpload } = await import("@/lib/image-finalize-direct.server");
    const { imageReencoderFromProcessEnv } = await import("@/lib/image-runtime/select.server");
    return finalizeDirectImageUpload(
      {
        admin: supabaseAdmin,
        reencode: imageReencoderFromProcessEnv().reencode,
        scan: (target, userId) => scanImageForSafety(target, { userId }) as never,
        objectUrl: (bucket, path) => imageObjectUrl(supabaseAdmin, bucket, path),
        escalate: async (bucket, path, categories) => {
          await escalateImageForChildSafety(supabaseAdmin, {
            bucket,
            path,
            categories,
            source: "image_upload",
          });
        },
      },
      { userId: context.userId, bucket: data.bucket, path: data.path },
    );
  });

/**
 * Promote an image the browser staged in the private `image-staging` bucket: validate, remove personal metadata, scan, and only then
 * publish the clean bytes to `bucket` at `targetPath`. The destination never holds the original.
 */
export const promoteStagedImageUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { bucket: string; stagingPath: string; targetPath: string }) =>
    z
      .object({
        bucket: z.string().max(60),
        stagingPath: z.string().min(1).max(300),
        targetPath: z.string().min(1).max(300),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { scanImageForSafety } = await import("@/lib/image-safety.server");
    const { escalateImageForChildSafety } = await import("@/lib/ai/moderation.server");
    const { promoteStagedImage } = await import("@/lib/image-promotion.server");
    const { imageReencoderFromProcessEnv } = await import("@/lib/image-runtime/select.server");
    return promoteStagedImage(
      {
        admin: supabaseAdmin,
        // The configured image runtime (IMAGE_RUNTIME; disabled unless set): audit F09.
        reencode: imageReencoderFromProcessEnv().reencode,
        scan: (target, userId) => scanImageForSafety(target, { userId }) as never,
        escalate: async (bucket, path, categories) => {
          await escalateImageForChildSafety(supabaseAdmin, {
            bucket,
            path,
            categories,
            source: "image_upload",
          });
        },
      },
      { userId: context.userId, ...data },
    );
  });

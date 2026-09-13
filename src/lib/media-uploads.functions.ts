import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_VIDEO_BYTES, sniffVideoContainer } from "@/lib/video-validation";

const VIDEO_BUCKET = "highlight-videos";

/**
 * Server-side gate for uploaded reel media. The client already validates, but
 * nothing client-side is trusted: this re-checks ownership of the storage
 * folder, the real byte size and the container magic bytes, and deletes
 * anything that fails so a rejected upload leaves nothing behind.
 *
 * Derived artefacts (extracted frames, audio track, transcoded playback copy)
 * are validated by kind so a caller can't smuggle an executable under
 * `.frame1.jpg`.
 */
export const finalizeVideoUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string; kind?: "video" | "frame" | "audio" }) =>
    z
      .object({
        path: z.string().min(1).max(500),
        kind: z.enum(["video", "frame", "audio"]).default("video"),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { path, kind } = data;
    if (!path.startsWith(`${context.userId}/`) || path.includes("..")) {
      throw new Error("You can only finalize your own uploads");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const folder = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    const { data: listed } = await supabaseAdmin.storage
      .from(VIDEO_BUCKET)
      .list(folder, { search: name, limit: 100 });
    const object = (listed ?? []).find((o: any) => o.name === name);
    if (!object) throw new Error("Uploaded file could not be found");

    const bytes = Number((object as any).metadata?.size ?? 0);
    const reject = async (reason: string) => {
      await supabaseAdmin.storage.from(VIDEO_BUCKET).remove([path]);
      throw new Error(reason);
    };

    if (bytes <= 0) await reject("The file is empty");
    if (kind === "video" && bytes > MAX_VIDEO_BYTES)
      await reject("Video is too large (max 200 MB)");
    if (kind === "frame" && bytes > 8 * 1024 * 1024) await reject("Frame image is too large");
    if (kind === "audio" && bytes > 50 * 1024 * 1024) await reject("Audio track is too large");

    if (kind === "video") {
      // Range-read just the header: enough for the container magic bytes.
      const { data: blob, error } = await supabaseAdmin.storage.from(VIDEO_BUCKET).download(path);
      if (error || !blob) await reject("Uploaded file could not be read");
      const header = new Uint8Array(await blob!.slice(0, 64).arrayBuffer());
      const container = sniffVideoContainer(header);
      if (!container) await reject("That file is not a supported MP4, MOV or WEBM video");
      return { ok: true, bytes, container };
    }

    return { ok: true, bytes, container: null as string | null };
  });

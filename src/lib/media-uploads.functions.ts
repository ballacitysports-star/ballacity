import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_VIDEO_BYTES, sniffVideoContainer } from "@/lib/video-validation";
import {
  clipLengthProblem,
  mp4DurationSeconds,
  mp4VideoSize,
  resolutionProblem,
  uploadSizeProblem,
  type ByteReader,
  type ClipLimits,
} from "@/lib/ai/upload-limits";

const VIDEO_BUCKET = "highlight-videos";

/** Ranged reads are fetched in blocks this size, so walking box headers costs a few requests. */
const RANGE_BLOCK_BYTES = 256 * 1024;

/**
 * Reads byte ranges of a stored clip through a short-lived signed URL, caching
 * whole blocks. `failed()` reports whether any read came back as anything but
 * the exact range asked for (a server ignoring Range, an error, a short body);
 * a caller must not trust what it read when it did. Null when no URL could be
 * signed.
 */
async function rangedObjectReader(
  admin: { storage: { from: (bucket: string) => any } },
  path: string,
  total: number,
): Promise<{ read: ByteReader; failed: () => boolean } | null> {
  const { data, error } = await admin.storage.from(VIDEO_BUCKET).createSignedUrl(path, 60);
  const url: string | undefined = data?.signedUrl;
  if (error || !url || total <= 0) return null;
  let failed = false;
  const blocks = new Map<number, Promise<Uint8Array>>();
  const block = (index: number) => {
    let pending = blocks.get(index);
    if (!pending) {
      const start = index * RANGE_BLOCK_BYTES;
      const end = Math.min(total, start + RANGE_BLOCK_BYTES);
      pending = (async () => {
        const res = await fetch(url, { headers: { range: `bytes=${start}-${end - 1}` } });
        if (res.status !== 206) {
          await res.body?.cancel().catch(() => {});
          throw new Error(`Range read refused (${res.status})`);
        }
        const body = new Uint8Array(await res.arrayBuffer());
        if (body.length !== end - start) throw new Error("Short range read");
        return body;
      })().catch((e) => {
        failed = true;
        throw e;
      });
      blocks.set(index, pending);
    }
    return pending;
  };
  const read: ByteReader = async (start, end) => {
    start = Math.max(0, start);
    end = Math.min(total, end);
    if (end <= start) return new Uint8Array(0);
    const first = Math.floor(start / RANGE_BLOCK_BYTES);
    const last = Math.floor((end - 1) / RANGE_BLOCK_BYTES);
    const parts = await Promise.all(
      Array.from({ length: last - first + 1 }, (_, i) => block(first + i)),
    );
    const out = new Uint8Array(end - start);
    parts.forEach((part, i) => {
      const blockStart = (first + i) * RANGE_BLOCK_BYTES;
      const from = Math.max(start, blockStart) - blockStart;
      const to = Math.min(end, blockStart + part.length) - blockStart;
      out.set(part.subarray(from, to), blockStart + from - start);
    });
    return out;
  };
  return { read, failed: () => failed };
}

/**
 * Server-side gate for uploaded reel media. The client already validates, but
 * nothing client-side is trusted: this re-checks ownership of the storage
 * folder, the real byte size and the container magic bytes, and deletes
 * anything that fails so a rejected upload leaves nothing behind.
 *
 * Derived artefacts (extracted frames, audio track, transcoded playback copy)
 * are validated by kind so a caller can't smuggle an executable under
 * `.frame1.jpg`.
 *
 * `kind` splits on one question: will a viewer ever load these bytes as video?
 *
 *   - `video` — yes. The container is sniffed and anything unrecognised is
 *     deleted. This is the trust boundary, and it does not move: the uploader
 *     now accepts any source format, so this is what stops an executable being
 *     stored at a path the feed will hand to a `<video>` element.
 *   - `source` — no. The athlete's original in an exotic container (`.avi`,
 *     `.mkv`, `.wmv`…), kept beside the converted copy for provenance and the
 *     "Open or download" link. Size and ownership are still enforced; the
 *     container check is skipped, because refusing these is exactly the bug
 *     being fixed. A `source` is only ever written when a playable `video`
 *     sibling exists, so nothing reaches a player through this path.
 *
 * A new upload (`purpose: "upload"`) must also fit the member's AI tier: its
 * size against `maxUploadMb`, and for an MP4/QuickTime `video` its length and
 * picture size, read from the file's own movie header, against
 * `maxVideoSeconds` and `maxResolution` (the uploader shrinks a larger clip
 * before it gets here). A `source` original is never served for playback, so
 * its resolution is not limited. A playback
 * repair re-encodes a reel that already exists, so it is held only to the
 * Storage cap — and only when that reel really is the caller's.
 */
export const finalizeVideoUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      path: string;
      kind?: "video" | "source" | "frame" | "audio";
      purpose?: "upload" | "repair";
    }) =>
      z
        .object({
          path: z.string().min(1).max(500),
          kind: z.enum(["video", "source", "frame", "audio"]).default("video"),
          purpose: z.enum(["upload", "repair"]).default("upload"),
        })
        .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { path, kind, purpose } = data;
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
    if ((kind === "video" || kind === "source") && bytes > MAX_VIDEO_BYTES) {
      await reject("Video is too large (max 200 MB)");
    }

    const isClip = kind === "video" || kind === "source";
    let clipLimits: ClipLimits | null = null;
    if (isClip && purpose === "repair") {
      // Only the converted copy of one of the caller's existing reels.
      const suffix = ".h264.mp4";
      const original = path.endsWith(suffix) ? path.slice(0, -suffix.length) : null;
      const { data: reel } = original
        ? await supabaseAdmin
            .from("highlight_reels")
            .select("id")
            .eq("user_id", context.userId)
            .eq("video_path", original)
            .maybeSingle()
        : { data: null };
      if (!reel) await reject("That repair doesn't match one of your reels");
    } else if (isClip) {
      const { loadClipLimits } = await import("@/lib/ai/upload-limits.server");
      clipLimits = await loadClipLimits(supabaseAdmin, context.userId);
      const tooBig = uploadSizeProblem(bytes, clipLimits);
      if (tooBig) await reject(tooBig);
    }
    if (kind === "frame" && bytes > 8 * 1024 * 1024) await reject("Frame image is too large");
    if (kind === "audio" && bytes > 50 * 1024 * 1024) await reject("Audio track is too large");

    if (kind === "video") {
      // Only the container magic bytes and the movie header are read, by range,
      // rather than pulling the whole clip (up to 200 MB) into the Worker first.
      // Any read the ranged path can't vouch for falls back to the full download,
      // so this gate never passes a clip just because a range request failed.
      const inspect = async (read: ByteReader, total: number) => {
        const container = sniffVideoContainer(await read(0, 64));
        let seconds: number | null = null;
        let size: { width: number; height: number } | null = null;
        if (container === "mp4" || container === "quicktime") {
          seconds = await mp4DurationSeconds(read, total);
          size = await mp4VideoSize(read, total);
        }
        return { container, seconds, size };
      };
      let facts: Awaited<ReturnType<typeof inspect>> | null = null;
      const ranged = await rangedObjectReader(supabaseAdmin, path, bytes);
      if (ranged) {
        const result = await inspect(ranged.read, bytes).catch(() => null);
        if (result && !ranged.failed()) facts = result;
      }
      if (!facts) {
        const { data: blob, error } = await supabaseAdmin.storage.from(VIDEO_BUCKET).download(path);
        if (error || !blob) await reject("Uploaded file could not be read");
        facts = await inspect(
          async (start, end) => new Uint8Array(await blob!.slice(start, end).arrayBuffer()),
          blob!.size,
        );
      }
      const { container, seconds, size } = facts;
      if (!container) await reject("That file could not be prepared for playback");
      if (clipLimits) {
        const problem =
          clipLengthProblem(seconds, clipLimits) ?? resolutionProblem(size, clipLimits);
        if (problem) {
          // A converted copy's original was stored a moment ago; neither is kept.
          const suffix = ".h264.mp4";
          if (path.endsWith(suffix)) {
            await supabaseAdmin.storage.from(VIDEO_BUCKET).remove([path.slice(0, -suffix.length)]);
          }
          await reject(problem);
        }
      }
      return { ok: true, bytes, container, seconds, size };
    }

    return {
      ok: true,
      bytes,
      container: null as string | null,
      seconds: null as number | null,
      size: null as { width: number; height: number } | null,
    };
  });

/** The signed-in member's clip limits, so the uploader can refuse early and say why. */
export const getMyClipLimits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadClipLimits } = await import("@/lib/ai/upload-limits.server");
    return loadClipLimits(supabaseAdmin, context.userId);
  });

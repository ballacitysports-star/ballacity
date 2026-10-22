import { createServerFn } from "@tanstack/react-start";

export type PublicReel =
  | { found: false }
  | {
      found: true;
      id: string;
      title: string;
      caption: string | null;
      hashtags: string[];
      sport: string | null;
      videoUrl: string;
      fallbackVideoUrl: string | null;
      thumbnailUrl: string | null;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One reel for its shareable page. Anyone with the link can watch, so the gate
 * is strict and lives in SQL: `reel_audience()` must say 'public' (adult, posted,
 * completed, not hidden, not a family clip, account not locked). Reels for
 * 13-17 year-olds are 'members'/'none' and are never served here. Every refusal
 * looks the same ({ found: false }) so a private reel's existence isn't revealed.
 */
export const getPublicReel = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => ({
    id: typeof input?.id === "string" && UUID.test(input.id) ? input.id : "",
  }))
  .handler(async ({ data }): Promise<PublicReel> => {
    if (!data.id) return { found: false };
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { quarantinedMediaPaths, signablePath } = await import("@/lib/reel-visibility.server");
      const { ownedMediaPathOrNull } = await import("@/lib/media-path-guard");

      const { data: audience, error: audErr } = await supabaseAdmin.rpc(
        "reel_audience" as never,
        { _reel_id: data.id } as never,
      );
      if (audErr || audience !== "public") return { found: false };

      const { data: r, error } = await supabaseAdmin
        .from("highlight_reels")
        .select(
          "id,user_id,title,ai_title,ai_caption,ai_hashtags,ai_sport,video_path,playback_path,thumbnail_path,subject_child_id",
        )
        .eq("id", data.id)
        .maybeSingle();
      if (error || !r || r.subject_child_id) return { found: false };
      const row = r;

      const owner = row.user_id as string;
      const quarantined = await quarantinedMediaPaths(supabaseAdmin, [
        row.playback_path,
        row.video_path,
        row.thumbnail_path,
      ]);
      const primary = signablePath(
        ownedMediaPathOrNull(owner, row.playback_path ?? row.video_path),
        quarantined,
      );
      const original = row.playback_path
        ? signablePath(ownedMediaPathOrNull(owner, row.video_path), quarantined)
        : null;
      const thumb = signablePath(ownedMediaPathOrNull(owner, row.thumbnail_path), quarantined);
      if (!primary) return { found: false };

      const sign = async (p: string | null) =>
        p
          ? ((await supabaseAdmin.storage.from("highlight-videos").createSignedUrl(p, 3600)).data
              ?.signedUrl ?? null)
          : null;
      const [videoUrl, fallbackVideoUrl, thumbnailUrl] = await Promise.all([
        sign(primary),
        sign(original),
        sign(thumb),
      ]);
      if (!videoUrl) return { found: false };

      return {
        found: true,
        id: row.id as string,
        title: String(row.ai_title || row.title || "Highlight").slice(0, 120),
        caption: row.ai_caption ? String(row.ai_caption).slice(0, 500) : null,
        hashtags: ((row.ai_hashtags as string[]) ?? []).slice(0, 5),
        sport: (row.ai_sport as string) ?? null,
        videoUrl,
        fallbackVideoUrl,
        thumbnailUrl,
      };
    } catch {
      return { found: false };
    }
  });

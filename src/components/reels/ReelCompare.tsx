/**
 * Compare mode: current reel vs a restyled draft, side by side.
 *
 * The draft is generated in memory on the server (same captured footage, new
 * style) and never touches the stored reel until the athlete publishes it — so
 * they can preview both versions, then keep or discard the restyle.
 */

import { useEffect, useState } from "react";
import { Columns2, Loader2, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ReelStylePanel } from "@/components/reels/ReelStylePanel";
import {
  ReelStudio,
  type Coaching,
  type EditPlan,
  type TimelineEntry,
} from "@/components/reels/ReelStudio";
import { normalizeReelStyle, reelStyleSummary, type ReelStylePrefs } from "@/lib/reel-style";
import { applyReelStyleDraft, previewReelStyle } from "@/lib/reels.functions";

export type ReelStyleDraft = {
  style: Record<string, any>;
  ai_title: string | null;
  ai_caption: string | null;
  ai_hashtags: string[];
  timeline: TimelineEntry[];
  edit_plan: EditPlan | null;
  coaching: Coaching | null;
  thumbnail_path: string | null;
  overlays: { at: string; text: string }[];
};

type CompareReel = {
  id: string;
  title: string;
  video_path: string;
  playback_path?: string | null;
  ai_title: string | null;
  ai_caption: string | null;
  ai_hashtags: string[] | null;
  ai_sport?: string | null;
  ai_timeline?: TimelineEntry[] | null;
  ai_edit_plan?: EditPlan | null;
  ai_coaching?: Coaching | null;
  ai_transcript?: { text?: string } | null;
  ai_overlays?: { at: string; text: string }[] | null;
  style_prefs?: Record<string, any> | null;
};

function CopyBlock({
  title,
  caption,
  hashtags,
  overlays,
}: {
  title: string;
  caption?: string | null;
  hashtags?: string[] | null;
  overlays?: { at: string; text: string }[];
}) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <p className="text-sm font-semibold">{title}</p>
      {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
      {(hashtags ?? []).length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {(hashtags ?? []).map((h, i) => (
            <li
              key={`${h}-${i}`}
              className="rounded-full border border-lime/40 bg-lime/10 px-2 py-0.5 text-[10px] font-semibold text-lime"
            >
              #{String(h).replace(/^#/, "")}
            </li>
          ))}
        </ul>
      )}
      {(overlays ?? []).length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {(overlays ?? []).map((o, i) => (
            <li key={i} className="text-[11px] text-muted-foreground">
              <span className="font-mono font-semibold text-lime">{o.at}</span> {o.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReelCompare({ reel }: { reel: CompareReel }) {
  const [open, setOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [style, setStyle] = useState<ReelStylePrefs>(() => normalizeReelStyle(reel.style_prefs));
  const [draft, setDraft] = useState<ReelStyleDraft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!open || videoUrl) return;
    let cancelled = false;
    void supabase.storage
      .from("highlight-videos")
      .createSignedUrl(reel.playback_path ?? reel.video_path, 3600)
      .then(({ data }) => {
        if (!cancelled) setVideoUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, videoUrl, reel.playback_path, reel.video_path]);

  async function generate() {
    setGenerating(true);
    try {
      const result = (await previewReelStyle({
        data: { reelId: reel.id, style },
      })) as unknown as ReelStyleDraft;
      setDraft(result);
      toast.success("Restyled preview ready — compare before you publish");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not build the restyled preview");
    } finally {
      setGenerating(false);
    }
  }

  async function publish() {
    if (!draft) return;
    setPublishing(true);
    try {
      await applyReelStyleDraft({ data: { reelId: reel.id, draft } });
      toast.success("Published the restyled version");
      setDraft(null);
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not publish this version");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-lime"
      >
        <Columns2 className="h-3.5 w-3.5" />
        {open ? "Close compare" : "Compare & restyle"}
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          <ReelStylePanel
            value={style}
            sport={reel.ai_sport ?? null}
            onChange={setStyle}
            disabled={generating || publishing}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={generate}
              disabled={generating || publishing}
              className="inline-flex items-center gap-1.5 rounded-full bg-lime px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {draft ? "Regenerate preview" : "Preview this style"}
            </button>
            {draft && (
              <>
                <button
                  onClick={publish}
                  disabled={publishing}
                  className="inline-flex items-center gap-1.5 rounded-full border border-lime px-3 py-1.5 text-xs font-bold text-lime disabled:opacity-50"
                >
                  {publishing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  Publish restyled version
                </button>
                <button
                  onClick={() => setDraft(null)}
                  disabled={publishing}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Discard preview
                </button>
              </>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Previews reuse the captured footage analysis — nothing changes on your published reel
            until you publish the restyled version.
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            <section className="rounded-xl border border-border p-3">
              <p className="micro-label text-muted-foreground">
                Current · {reelStyleSummary(normalizeReelStyle(reel.style_prefs))}
              </p>
              <CopyBlock
                title={reel.ai_title || reel.title}
                caption={reel.ai_caption}
                hashtags={reel.ai_hashtags}
                overlays={reel.ai_overlays ?? []}
              />
              {videoUrl ? (
                <ReelStudio
                  videoUrl={videoUrl}
                  timeline={reel.ai_timeline ?? []}
                  editPlan={reel.ai_edit_plan ?? null}
                  coaching={reel.ai_coaching ?? null}
                  transcript={reel.ai_transcript?.text ?? null}
                  overlays={reel.ai_overlays ?? []}
                  style={reel.style_prefs}
                />
              ) : (
                <p className="mt-3 text-[11px] text-muted-foreground">Loading video…</p>
              )}
            </section>

            <section className="rounded-xl border border-lime/50 p-3">
              <p className="micro-label text-lime">
                Restyled preview · {reelStyleSummary(style)}
              </p>
              {draft ? (
                <>
                  <CopyBlock
                    title={draft.ai_title || reel.title}
                    caption={draft.ai_caption}
                    hashtags={draft.ai_hashtags}
                    overlays={draft.overlays}
                  />
                  {videoUrl && (
                    <ReelStudio
                      videoUrl={videoUrl}
                      timeline={draft.timeline ?? []}
                      editPlan={draft.edit_plan ?? null}
                      coaching={draft.coaching ?? null}
                      transcript={reel.ai_transcript?.text ?? null}
                      overlays={draft.overlays ?? []}
                      style={draft.style}
                    />
                  )}
                </>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-border p-4 text-center">
                  <RefreshCw className="mx-auto h-4 w-4 text-muted-foreground" />
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Pick a style above, then preview it here next to your current reel.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

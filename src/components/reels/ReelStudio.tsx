/**
 * Reel Studio: the player surface for the AI reel agent's output.
 *
 * - Play-by-play timeline you can tap to jump to a moment
 * - "Play the AI edit": the planned cut list rendered live in the player
 *   (segment-by-segment with per-segment pacing) — no video re-encoding
 * - Coaching report (strengths / fix / drills) and the spoken transcript
 */

import { useEffect, useRef, useState } from "react";
import { Film, ListVideo, MessageSquareQuote, Pause, Play, Dumbbell } from "lucide-react";

export type TimelineEntry = { t: number; label: string; note?: string };
export type EditSegment = { start: number; end: number; pace?: string; why?: string };
export type EditPlan = { segments: EditSegment[]; why?: string; total?: number };
export type Coaching = {
  strengths?: string[];
  notes?: string[];
  drills?: string[];
  confidence?: string;
};

const PACE_RATE: Record<string, number> = { normal: 1, slowmo: 0.5, hold: 0.35, quick: 1.5 };

function clock(t: number): string {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ReelStudio({
  videoUrl,
  timeline = [],
  editPlan,
  coaching,
  transcript,
}: {
  videoUrl: string;
  timeline?: TimelineEntry[];
  editPlan?: EditPlan | null;
  coaching?: Coaching | null;
  transcript?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [segIndex, setSegIndex] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const segments = editPlan?.segments ?? [];

  // Drive the live cut: play each planned segment in order, at its own pace.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || segIndex == null) return;
    const seg = segments[segIndex];
    if (!seg) {
      setSegIndex(null);
      return;
    }
    video.playbackRate = PACE_RATE[String(seg.pace ?? "normal")] ?? 1;
    try {
      video.currentTime = seg.start;
    } catch {
      /* seeking before metadata — the play() below still starts it */
    }
    void video.play().catch(() => setSegIndex(null));

    const onTime = () => {
      if (video.currentTime >= seg.end - 0.05) {
        if (segIndex + 1 < segments.length) setSegIndex(segIndex + 1);
        else {
          video.pause();
          video.playbackRate = 1;
          setSegIndex(null);
        }
      }
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [segIndex, segments]);

  function jumpTo(t: number) {
    const video = videoRef.current;
    if (!video) return;
    setSegIndex(null);
    video.playbackRate = 1;
    try {
      video.currentTime = t;
    } catch {
      /* ignore */
    }
    void video.play().catch(() => {});
  }

  const playingCut = segIndex != null;

  return (
    <div className="mt-3 space-y-3">
      <video ref={videoRef} src={videoUrl} controls className="w-full rounded-lg" />

      {segments.length > 0 && (
        <div className="rounded-xl border border-border bg-background/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-lime">
              <Film className="h-3.5 w-3.5" />
              AI edit · {segments.length} cuts
              {editPlan?.total ? ` · ${editPlan.total}s` : ""}
            </p>
            <button
              onClick={() => {
                if (playingCut) {
                  videoRef.current?.pause();
                  if (videoRef.current) videoRef.current.playbackRate = 1;
                  setSegIndex(null);
                } else setSegIndex(0);
              }}
              className="inline-flex items-center gap-1 rounded-full bg-lime px-2.5 py-1 text-[11px] font-semibold text-background"
            >
              {playingCut ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {playingCut ? "Stop" : "Play the AI edit"}
            </button>
          </div>
          {editPlan?.why && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">{editPlan.why}</p>
          )}
          <ol className="mt-2 space-y-1">
            {segments.map((s, i) => (
              <li key={`${s.start}-${i}`}>
                <button
                  onClick={() => setSegIndex(i)}
                  className={`flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-[11px] ${
                    segIndex === i ? "bg-lime/15 text-lime" : "text-muted-foreground"
                  }`}
                >
                  <span className="font-mono font-semibold">
                    {clock(s.start)}–{clock(s.end)}
                  </span>
                  <span className="flex-1 break-words">
                    {s.why || "Keep this beat"}
                    {s.pace && s.pace !== "normal" ? ` · ${s.pace}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {timeline.length > 0 && (
        <div className="rounded-xl border border-border bg-background/60 p-3">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-lime">
            <ListVideo className="h-3.5 w-3.5" />
            Play-by-play
          </p>
          <ul className="mt-2 space-y-1">
            {timeline.map((e, i) => (
              <li key={`${e.t}-${i}`}>
                <button
                  onClick={() => jumpTo(e.t)}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-lime/10 hover:text-lime"
                >
                  <span className="font-mono font-semibold text-lime">{clock(e.t)}</span>
                  <span className="flex-1 break-words">
                    <span className="font-semibold text-foreground">{e.label}</span>
                    {e.note ? ` — ${e.note}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {coaching &&
        ((coaching.strengths ?? []).length > 0 ||
          (coaching.notes ?? []).length > 0 ||
          (coaching.drills ?? []).length > 0) && (
          <div className="rounded-xl border border-border bg-background/60 p-3">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-lime">
              <Dumbbell className="h-3.5 w-3.5" />
              Coaching report
            </p>
            {(
              [
                ["What's working", coaching.strengths ?? []],
                ["What to fix", coaching.notes ?? []],
                ["Drills", coaching.drills ?? []],
              ] as const
            ).map(([label, items]) =>
              items.length ? (
                <div key={label} className="mt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <ul className="mt-0.5 space-y-0.5">
                    {items.map((it, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground">
                        • {it}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
            {coaching.confidence && (
              <p className="mt-2 text-[10px] italic text-muted-foreground/80">
                {coaching.confidence}
              </p>
            )}
          </div>
        )}

      {transcript && (
        <div className="rounded-xl border border-border bg-background/60 p-3">
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-lime"
          >
            <MessageSquareQuote className="h-3.5 w-3.5" />
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </button>
          {showTranscript && (
            <p className="mt-2 whitespace-pre-wrap text-[11px] text-muted-foreground">
              {transcript}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

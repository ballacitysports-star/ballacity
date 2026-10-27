import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Camera,
  Columns2,
  FileVideo,
  Grid3x3,
  Link2,
  Pencil,
  RefreshCw,
  Ruler,
  Trash2,
  Triangle,
  Undo2,
  Upload,
} from "lucide-react";
import {
  ANNOTATION_COLORS,
  COLOR_ORDER,
  clearFrame,
  undoLast,
  type Annotation,
  type AnnotationColor,
  type DrawingTool,
} from "@/lib/motion/annotations";
import { PLAYBACK_SPEEDS, normalizeLoop, stepTime } from "@/lib/motion/frames";
import { KINOGRAM_COUNTS, kinogramTimes } from "@/lib/motion/kinogram";
import { KinogramDialog } from "./KinogramDialog";
import { MotionStage } from "./MotionStage";
import { Transport, type TransportModel } from "./Transport";
import { renderFrameBlob, saveOrShareBlob } from "./export";
import { useMotionPlayer, type MotionPlayer } from "./use-motion-player";

const VIDEO_NAME = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;

export function looksLikeVideo(file: { type: string; name: string }): boolean {
  return file.type.startsWith("video/") || VIDEO_NAME.test(file.name);
}

const TOOLS: { id: DrawingTool; label: string; icon: typeof Ruler; hint: string }[] = [
  {
    id: "line",
    label: "Line",
    icon: Ruler,
    hint: "Drag, or tap two points. Shows the tilt from level.",
  },
  {
    id: "angle",
    label: "Angle",
    icon: Triangle,
    hint: "Tap or drag three points: one arm, the joint, the other arm.",
  },
  { id: "pen", label: "Pen", icon: Pencil, hint: "Draw freehand." },
];

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

export function MotionReview() {
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const A = useMotionPlayer(fileA);
  const B = useMotionPlayer(fileB);
  const [compare, setCompare] = useState(false);
  const [linked, setLinked] = useState(false);
  const offset = useRef(0);
  const [active, setActive] = useState<0 | 1>(0);
  const [tool, setTool] = useState<DrawingTool | null>(null);
  const [color, setColor] = useState<AnnotationColor>("lime");
  const [persist, setPersist] = useState(false);
  const [drawA, setDrawA] = useState<Annotation[]>([]);
  const [drawB, setDrawB] = useState<Annotation[]>([]);
  const [kinogramOpen, setKinogramOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputA = useRef<HTMLInputElement | null>(null);
  const inputB = useRef<HTMLInputElement | null>(null);

  const hasB = compare && !!fileB;
  const canLink = !!fileA && hasB;
  const isLinked = linked && canLink;
  const current: MotionPlayer = active === 1 && hasB ? B : A;
  const drawings = active === 1 && hasB ? drawB : drawA;
  const setDrawings = active === 1 && hasB ? setDrawB : setDrawA;

  const choose = (slot: 0 | 1, file: File | undefined | null) => {
    if (!file) return;
    if (!looksLikeVideo(file)) {
      toast.error("That doesn't look like a video. Choose an MP4 or MOV from your camera roll.");
      return;
    }
    if (slot === 0) {
      setFileA(file);
      setDrawA([]);
    } else {
      setFileB(file);
      setDrawB([]);
    }
    setLinked(false);
    setActive(slot);
  };

  // Linking pins the gap between the two playheads: line both clips up on the same
  // moment first (say, ball release), then link.
  const toggleLink = () => {
    if (!canLink) return;
    if (!linked) offset.current = B.time - A.time;
    A.pause();
    B.pause();
    setLinked((v) => !v);
  };

  const linkedModel: TransportModel = {
    time: A.time,
    duration: A.duration,
    playing: A.playing || B.playing,
    rate: A.rate,
    fps: A.fps,
    loopStart: A.loopStart,
    loopEnd: A.loopEnd,
    loopOn: A.loopOn,
    toggle: () => {
      if (A.playing || B.playing) {
        A.pause();
        B.pause();
      } else {
        A.play();
        B.play();
      }
    },
    seek: (t) => {
      A.seek(t);
      B.seek(t + offset.current);
    },
    // Linked means the same MOMENT, not the same number of frames: a 120 fps clip and a
    // 30 fps clip must stay on one instant when you step.
    step: (n) => {
      const t = stepTime(A.video()?.currentTime ?? A.time, n, A.fps, A.duration);
      A.pause();
      B.pause();
      A.seek(t);
      B.seek(t + offset.current);
    },
    setRate: (r) => {
      A.setRate(r);
      B.setRate(r);
    },
    markLoopStart: A.markLoopStart,
    markLoopEnd: A.markLoopEnd,
    toggleLoop: A.toggleLoop,
    clearLoop: A.clearLoop,
  };

  // When the lead clip's loop jumps back, the other follows, keeping the gap.
  useEffect(() => {
    if (!isLinked || A.loopWraps === 0) return;
    const range = normalizeLoop(A.loopStart, A.loopEnd, A.duration, A.fps);
    if (range) B.seek(range.start + offset.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [A.loopWraps]);

  const controls: TransportModel = isLinked ? linkedModel : current;

  // Keyboard: space, arrows, comma and period, brackets, L, 1-4, Escape, Ctrl/Cmd+Z.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setDrawings((l) => undoLast(l));
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const n = e.shiftKey ? 10 : 1;
      const speed =
        Number(e.key) >= 1 && Number(e.key) <= PLAYBACK_SPEEDS.length
          ? PLAYBACK_SPEEDS[Number(e.key) - 1]
          : null;
      let handled = true;
      if (e.key === " ") controls.toggle();
      else if (e.key === "ArrowLeft" || e.key === ",") controls.step(-n);
      else if (e.key === "ArrowRight" || e.key === ".") controls.step(n);
      else if (e.key === "[") controls.markLoopStart();
      else if (e.key === "]") controls.markLoopEnd();
      else if (e.key.toLowerCase() === "l") controls.toggleLoop();
      else if (e.key === "Escape") setTool(null);
      else if (speed != null) controls.setRate(speed);
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const saveFrame = async () => {
    const video = current.video();
    if (!video || !current.src) return;
    setSaving(true);
    try {
      current.pause();
      const blob = await renderFrameBlob(video, drawings, current.fps);
      const stem = (current.fileName || "frame").replace(/\.[^.]+$/, "");
      const how = await saveOrShareBlob(
        blob,
        `${stem}-frame-${Math.round(current.time * 1000)}ms.png`,
      );
      if (how === "saved") toast.success("Saved to your downloads.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save that frame.");
    } finally {
      setSaving(false);
    }
  };

  const kinogramRange = useMemo(
    () =>
      normalizeLoop(current.loopStart, current.loopEnd, current.duration, current.fps) ?? {
        start: 0,
        end: current.duration,
      },
    [current.loopStart, current.loopEnd, current.duration, current.fps],
  );

  const stageProps = (slot: 0 | 1) => ({
    tool,
    color,
    persist,
    active: active === slot,
    onActivate: () => setActive(slot),
    compact: compare,
  });

  if (!fileA) {
    return (
      <div
        className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          choose(0, e.dataTransfer.files?.[0]);
        }}
      >
        <FileVideo className="mx-auto h-10 w-10 text-lime" aria-hidden />
        <h2 className="mt-3 font-display text-base font-bold">Choose a video to review</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Pick a clip from your camera roll. Slow-motion clips work best. The video stays on this
          device; nothing is uploaded.
        </p>
        <button
          type="button"
          onClick={() => inputA.current?.click()}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-primary-foreground"
        >
          <Upload className="h-4 w-4" aria-hidden /> Choose video
        </button>
        <input
          ref={inputA}
          type="file"
          accept="video/*,.mov,.mp4,.m4v"
          className="sr-only"
          aria-label="Choose a video"
          onChange={(e) => {
            choose(0, e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-2.5"
        role="toolbar"
        aria-label="Drawing tools"
      >
        {TOOLS.map(({ id, label, icon: Icon, hint }) => (
          <button
            key={id}
            type="button"
            title={hint}
            aria-pressed={tool === id}
            onClick={() => setTool((t) => (t === id ? null : id))}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold ${tool === id ? "border-lime bg-lime/15 text-lime" : "border-border"}`}
          >
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </button>
        ))}
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
        <div className="flex items-center gap-1.5" role="group" aria-label="Drawing colour">
          {COLOR_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`${c} drawings`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              style={{ backgroundColor: ANNOTATION_COLORS[c] }}
              className={`h-7 w-7 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
            />
          ))}
        </div>
        <label className="ml-1 flex min-h-10 items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
          <Grid3x3 className="h-3.5 w-3.5" aria-hidden /> Keep on every frame
        </label>
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Undo last drawing"
            title="Undo (Ctrl/Cmd+Z)"
            disabled={drawings.length === 0}
            onClick={() => setDrawings((l) => undoLast(l))}
            className="grid h-10 w-10 place-items-center rounded-full border border-border disabled:opacity-40"
          >
            <Undo2 className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Clear drawings on this frame"
            title="Clear this frame"
            disabled={drawings.length === 0}
            onClick={() => setDrawings((l) => clearFrame(l, current.time, current.fps))}
            className="grid h-10 w-10 place-items-center rounded-full border border-border disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </span>
      </div>
      {tool ? (
        <p className="px-1 text-xs text-muted-foreground">
          {TOOLS.find((t) => t.id === tool)?.hint} Drawings stay on this frame unless you keep them
          on every frame.
        </p>
      ) : null}

      <div className={compare ? "grid gap-3 md:grid-cols-2" : ""}>
        <MotionStage
          player={A}
          label={compare ? "Clip A" : "Clip"}
          drawings={drawA}
          onAdd={(a) => setDrawA((l) => [...l, a])}
          {...stageProps(0)}
        />
        {compare ? (
          fileB ? (
            <MotionStage
              player={B}
              label="Clip B"
              drawings={drawB}
              onAdd={(a) => setDrawB((l) => [...l, a])}
              {...stageProps(1)}
            />
          ) : (
            <div className="grid min-h-[180px] place-items-center rounded-2xl border border-dashed border-border bg-surface p-6 text-center">
              <div>
                <p className="text-sm text-muted-foreground">
                  Add a second clip to compare side by side.
                </p>
                <button
                  type="button"
                  onClick={() => inputB.current?.click()}
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold"
                >
                  <Upload className="h-4 w-4" aria-hidden /> Choose second video
                </button>
              </div>
            </div>
          )
        ) : null}
      </div>
      <input
        ref={inputB}
        type="file"
        accept="video/*,.mov,.mp4,.m4v"
        className="sr-only"
        aria-label="Choose a second video"
        onChange={(e) => {
          choose(1, e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {isLinked ? (
        <Transport model={linkedModel} label="Linked clips" disabled={false} />
      ) : (
        <div className={hasB ? "grid gap-3 md:grid-cols-2" : ""}>
          <Transport model={A} label={hasB ? "Clip A" : "Clip"} disabled={!A.src || !!A.error} />
          {hasB ? <Transport model={B} label="Clip B" disabled={!B.src || !!B.error} /> : null}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={saveFrame}
          disabled={saving || !current.src}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold disabled:opacity-40"
        >
          <Camera className="h-4 w-4" aria-hidden /> Save this frame
        </button>
        <button
          type="button"
          onClick={() => {
            current.pause();
            setKinogramOpen(true);
          }}
          disabled={!current.src || !(current.duration > 0)}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold disabled:opacity-40"
        >
          <Grid3x3 className="h-4 w-4" aria-hidden /> Make a kinogram
        </button>
        <button
          type="button"
          aria-pressed={compare}
          onClick={() => {
            setCompare((v) => !v);
            setLinked(false);
            setActive(0);
          }}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${compare ? "border-lime bg-lime/15 text-lime" : "border-border"}`}
        >
          <Columns2 className="h-4 w-4" aria-hidden /> Compare two clips
        </button>
        {canLink ? (
          <button
            type="button"
            aria-pressed={isLinked}
            onClick={toggleLink}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${isLinked ? "border-lime bg-lime/15 text-lime" : "border-border"}`}
            title="Line both clips up on the same moment, then link them so they play and step together."
          >
            <Link2 className="h-4 w-4" aria-hidden /> {isLinked ? "Linked" : "Link playback"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => inputA.current?.click()}
          className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Different video
        </button>
        <input
          ref={inputA}
          type="file"
          accept="video/*,.mov,.mp4,.m4v"
          className="sr-only"
          aria-label="Choose a different video"
          onChange={(e) => {
            choose(0, e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {compare && fileB && !isLinked ? (
        <p className="px-1 text-xs text-muted-foreground">
          To step both clips together, line them up on the same moment (for example, the ball
          leaving the hand), then tap Link playback.
        </p>
      ) : null}
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Shortcuts: space plays or pauses, ← → step one frame (Shift for ten), [ and ] set the loop,
        L repeats it, 1–4 change speed, Esc stops drawing. Your video and drawings stay on this
        device.
      </p>

      <KinogramDialog
        open={kinogramOpen}
        onOpenChange={setKinogramOpen}
        src={current.src}
        drawings={drawings}
        fps={current.fps}
        range={kinogramRange}
        duration={current.duration}
        counts={KINOGRAM_COUNTS}
        timesFor={(count) =>
          kinogramTimes(
            kinogramRange.start,
            kinogramRange.end,
            count,
            current.fps,
            current.duration,
          )
        }
      />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  buildAnnotation,
  visibleAnnotations,
  type Annotation,
  type AnnotationColor,
  type DrawingTool,
} from "@/lib/motion/annotations";
import {
  emptyDraw,
  pointerDown,
  pointerMove,
  pointerUp,
  previewAnnotation,
  previewPoints,
  type DrawState,
} from "@/lib/motion/draw-input";
import { COMMON_FPS } from "@/lib/motion/frames";
import { containRect, toNormalized, type Size } from "@/lib/motion/geometry";
import { paintAnnotation, paintAnnotations, type Ctx2D } from "@/lib/motion/paint";
import type { MotionPlayer } from "./use-motion-player";

const FPS_SOURCE_LABEL = {
  file: "from the file",
  assumed: "assumed",
  manual: "set by you",
} as const;

/** Picks the playback rate of one clip, shown over its picture. */
function FpsPicker({ player }: { player: MotionPlayer }) {
  const options = COMMON_FPS.includes(player.fps as (typeof COMMON_FPS)[number])
    ? [...COMMON_FPS]
    : [...COMMON_FPS, player.fps].sort((a, b) => a - b);
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="sr-only">Frames per second</span>
      <select
        aria-label="Frames per second"
        value={player.fps}
        onChange={(e) => player.setFps(Number(e.target.value))}
        className="min-h-8 rounded-md border border-border bg-background px-1.5 text-xs font-semibold text-foreground"
      >
        {options.map((f) => (
          <option key={f} value={f}>
            {f} fps
          </option>
        ))}
      </select>
      <span>{FPS_SOURCE_LABEL[player.fpsSource]}</span>
    </label>
  );
}

export function MotionStage({
  player,
  label,
  tool,
  color,
  persist,
  drawings,
  onAdd,
  onActivate,
  active,
  compact,
}: {
  player: MotionPlayer;
  label: string;
  tool: DrawingTool | null;
  color: AnnotationColor;
  persist: boolean;
  drawings: Annotation[];
  onAdd: (a: Annotation) => void;
  onActivate: () => void;
  active: boolean;
  compact: boolean;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [box, setBox] = useState<Size>({ w: 0, h: 0 });
  const [draw, setDraw] = useState<DrawState>(() => emptyDraw("line"));

  // Follow the picture's size, including when the phone is turned.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Choosing another tool abandons a half-finished drawing.
  useEffect(() => {
    setDraw(emptyDraw(tool ?? "line"));
  }, [tool]);

  // Repaint the drawings for this frame, and the one being made.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !(box.w > 0) || !(box.h > 0)) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.w * dpr);
    canvas.height = Math.round(box.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    const rect = containRect(box, player.size);
    const c = ctx as unknown as Ctx2D;
    paintAnnotations(c, visibleAnnotations(drawings, player.time, player.fps), rect, player.size);
    if (tool) {
      const pending = previewAnnotation(tool, previewPoints(draw), { color, time: player.time });
      if (pending) paintAnnotation(c, pending, rect, player.size);
    }
  }, [box, drawings, draw, tool, color, player.time, player.fps, player.size]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return toNormalized(
      { x: e.clientX - r.left, y: e.clientY - r.top },
      containRect(box, player.size),
    );
  };

  const finish = (pts: ReturnType<typeof previewPoints>) => {
    if (!tool) return;
    const time = player.video()?.currentTime ?? player.time;
    const made = buildAnnotation(tool, pts, { color, time, persist });
    if (made) onAdd(made);
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!tool || !(player.size.w > 0)) return;
    onActivate();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    player.pause(); // drawings belong to one frame, so hold it still
    const r = pointerDown(draw.tool === tool ? draw : emptyDraw(tool), point(e));
    setDraw(r.state);
    if (r.done) finish(r.done);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!tool) return;
    // Read the position now: React clears the event's currentTarget once this handler returns,
    // so it cannot be read later inside the state updater.
    const p = point(e);
    setDraw((d) => pointerMove(d, p));
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!tool) return;
    const r = pointerUp(draw, point(e));
    setDraw(r.state);
    if (r.done) finish(r.done);
  };

  return (
    <section
      aria-label={label}
      onPointerDown={onActivate}
      className={`overflow-hidden rounded-2xl border bg-surface ${active ? "border-lime/60" : "border-border"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <p className="min-w-0 truncate text-xs font-semibold" title={player.fileName}>
          {label}
          {player.fileName ? (
            <span className="font-normal text-muted-foreground"> · {player.fileName}</span>
          ) : null}
        </p>
        <FpsPicker player={player} />
      </div>
      <div
        ref={boxRef}
        className={`relative w-full bg-black ${compact ? "h-[30vh] min-h-[180px] md:h-[46vh]" : "h-[42vh] min-h-[220px] md:h-[56vh]"}`}
      >
        <video
          {...player.videoProps}
          aria-label={`${label} video`}
          className="absolute inset-0 h-full w-full object-contain"
          onClick={() => {
            if (!tool) player.toggle();
          }}
        />
        {player.error ? (
          <p
            role="alert"
            className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center text-sm text-white"
          >
            {player.error}
          </p>
        ) : null}
        <canvas
          ref={canvasRef}
          data-testid={`${label}-overlay`}
          className="absolute inset-0 h-full w-full"
          style={{
            pointerEvents: tool ? "auto" : "none",
            touchAction: tool ? "none" : "auto",
            cursor: tool ? "crosshair" : "default",
          }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => setDraw(emptyDraw(tool ?? "line"))}
        />
      </div>
    </section>
  );
}

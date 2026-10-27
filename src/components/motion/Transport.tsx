import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import {
  PLAYBACK_SPEEDS,
  formatClock,
  frameNumber,
  lastFrameIndex,
  normalizeLoop,
} from "@/lib/motion/frames";
import type { MotionPlayer } from "./use-motion-player";

/** What the transport bar needs. A linked pair of clips supplies its own. */
export type TransportModel = Pick<
  MotionPlayer,
  | "time"
  | "duration"
  | "playing"
  | "rate"
  | "fps"
  | "loopStart"
  | "loopEnd"
  | "loopOn"
  | "toggle"
  | "seek"
  | "step"
  | "setRate"
  | "markLoopStart"
  | "markLoopEnd"
  | "toggleLoop"
  | "clearLoop"
>;

const round =
  "grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-background hover:bg-surface disabled:opacity-40";
const chip = (on: boolean) =>
  `min-h-9 rounded-full border px-3 text-xs font-semibold ${on ? "border-lime bg-lime/15 text-lime" : "border-border"}`;

export function Transport({
  model,
  label,
  disabled,
}: {
  model: TransportModel;
  label: string;
  disabled: boolean;
}) {
  const total = lastFrameIndex(model.duration, model.fps) + 1;
  const loop = normalizeLoop(model.loopStart, model.loopEnd, model.duration, model.fps);
  return (
    <div
      className="space-y-3 rounded-2xl border border-border bg-surface p-3"
      role="group"
      aria-label={`${label} controls`}
    >
      <div className="flex items-center gap-2">
        <Slider
          aria-label="Position in clip"
          min={0}
          max={model.duration > 0 ? model.duration : 1}
          step={1 / model.fps}
          value={[Math.min(model.time, model.duration || 1)]}
          disabled={disabled}
          onValueChange={([v]) => model.seek(v)}
        />
      </div>
      <p
        className="text-center font-mono text-xs tabular-nums text-muted-foreground"
        aria-live="off"
      >
        {formatClock(model.time)} · frame {frameNumber(model.time, model.fps)} of {total}
      </p>

      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          className={round}
          disabled={disabled}
          onClick={() => model.step(-10)}
          aria-label="Back 10 frames"
          title="Back 10 frames"
        >
          <SkipBack className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          className={round}
          disabled={disabled}
          onClick={() => model.step(-1)}
          aria-label="Back one frame"
          title="Back one frame (←)"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-lime text-primary-foreground disabled:opacity-40"
          disabled={disabled}
          onClick={model.toggle}
          aria-label={model.playing ? "Pause" : "Play"}
          title="Play or pause (space)"
        >
          {model.playing ? (
            <Pause className="h-5 w-5" aria-hidden />
          ) : (
            <Play className="h-5 w-5" aria-hidden />
          )}
        </button>
        <button
          type="button"
          className={round}
          disabled={disabled}
          onClick={() => model.step(1)}
          aria-label="Forward one frame"
          title="Forward one frame (→)"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          className={round}
          disabled={disabled}
          onClick={() => model.step(10)}
          aria-label="Forward 10 frames"
          title="Forward 10 frames"
        >
          <SkipForward className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div
        className="flex flex-wrap items-center justify-center gap-1.5"
        role="group"
        aria-label="Playback speed"
      >
        {PLAYBACK_SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            className={chip(model.rate === s)}
            aria-pressed={model.rate === s}
            onClick={() => model.setRate(s)}
          >
            {s}×
          </button>
        ))}
      </div>

      <div
        className="flex flex-wrap items-center justify-center gap-1.5"
        role="group"
        aria-label="Loop"
      >
        <button
          type="button"
          disabled={disabled}
          className={chip(model.loopStart != null)}
          onClick={model.markLoopStart}
          title="Start the loop here ([)"
        >
          Loop start{model.loopStart != null ? ` ${formatClock(model.loopStart)}` : ""}
        </button>
        <button
          type="button"
          disabled={disabled}
          className={chip(model.loopEnd != null)}
          onClick={model.markLoopEnd}
          title="End the loop here (])"
        >
          Loop end{model.loopEnd != null ? ` ${formatClock(model.loopEnd)}` : ""}
        </button>
        <button
          type="button"
          disabled={disabled || !loop}
          className={chip(model.loopOn)}
          aria-pressed={model.loopOn}
          onClick={model.toggleLoop}
          title="Repeat the loop (L)"
        >
          <Repeat className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          Repeat
        </button>
        {model.loopStart != null || model.loopEnd != null ? (
          <button
            type="button"
            disabled={disabled}
            className={chip(false)}
            onClick={model.clearLoop}
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

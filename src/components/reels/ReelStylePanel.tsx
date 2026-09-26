import { useEffect, useRef, useState } from "react";
import { Sliders, Check } from "lucide-react";
import { ReelOverlayCard } from "@/components/reels/ReelOverlayCard";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { sampleOverlayText } from "@/lib/reel-copy";
import {
  cancelTransitionFx,
  effectiveTransition,
  playTransitionFx,
  TRANSITION_FX,
} from "@/lib/reel-playback";
import {
  OVERLAY_THEME_OPTIONS,
  PACING_OPTIONS,
  TRANSITION_OPTIONS,
  VIBE_OPTIONS,
  reelStyleSummary,
  type ReelPacing,
  type ReelStylePrefs,
} from "@/lib/reel-style";

type Group<T extends string> = {
  title: string;
  hint: string;
  options: { value: T; label: string; blurb: string }[];
  value: T;
  onSelect: (v: T) => void;
};

function ChipGroup<T extends string>({ title, hint, options, value, onSelect }: Group<T>) {
  return (
    <div>
      <p className="micro-label text-muted-foreground">
        {title}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(o.value)}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-lime bg-lime/10 text-lime"
                  : "border-border bg-background/40 text-foreground hover:border-lime/40"
              }`}
            >
              <span className="flex items-center gap-1 text-xs font-semibold">
                {active && <Check className="h-3 w-3" aria-hidden />}
                {o.label}
              </span>
              <span className="mt-0.5 block text-[10px] text-muted-foreground">{o.blurb}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Typical segment lengths (seconds) for each pacing, matching PACING_OPTIONS. */
const PACING_SHAPE: Record<ReelPacing, number[]> = {
  punchy: [3, 4, 3],
  balanced: [5, 4, 5, 3],
  slowburn: [7, 8, 8],
};
/** Longest cut the pipeline asks for; the strip is drawn against it. */
const MAX_CUT_SECONDS = 25;

/**
 * A mock of the chosen look: two stand-in clips joined by the chosen
 * transition, a sample text card in the overlay theme, and a strip showing
 * how the pacing splits the cut. Illustration only — no footage involved.
 * Plays only when the athlete picks a transition (`demo` bumps) or taps it —
 * never on page load or when a saved style is restored.
 */
function StylePreview({
  value,
  sport,
  demo,
}: {
  value: ReelStylePrefs;
  sport?: string | null;
  demo: number;
}) {
  const reducedMotion = useReducedMotion();
  const kindRef = useRef(value.transition);
  kindRef.current = effectiveTransition(value.transition, reducedMotion);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const veilRef = useRef<HTMLDivElement | null>(null);
  const fxRef = useRef<Animation[]>([]);
  const [clip, setClip] = useState(0);
  const [replays, setReplays] = useState(0);

  useEffect(() => {
    if (demo === 0 && replays === 0) return;
    const kind = kindRef.current;
    cancelTransitionFx(fxRef.current);
    fxRef.current = playTransitionFx(kind, "exit", {
      veil: veilRef.current,
      frame: frameRef.current,
    });
    const swap = window.setTimeout(() => {
      cancelTransitionFx(fxRef.current);
      setClip((c) => 1 - c);
      fxRef.current = playTransitionFx(kind, "enter", {
        veil: veilRef.current,
        frame: frameRef.current,
      });
    }, TRANSITION_FX[kind].exit * 1000);
    return () => window.clearTimeout(swap);
  }, [demo, replays]);

  const shape = PACING_SHAPE[value.pacing];
  const total = shape.reduce((n, s) => n + s, 0);
  const transitionLabel =
    TRANSITION_OPTIONS.find((o) => o.value === value.transition)?.label ?? "transition";

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setReplays((n) => n + 1)}
        aria-label={`Style preview: ${reelStyleSummary(value)}. Replay the transition.`}
        className="relative block h-28 w-full overflow-hidden rounded-xl border border-border bg-black text-left"
      >
        <div
          ref={frameRef}
          className={`absolute inset-0 ${clip === 0 ? "bg-lime-gradient" : "bg-coral-gradient"}`}
        >
          <div className="absolute inset-0 grid-noise bg-black/35" />
          <ReelOverlayCard
            key={`${clip}-${value.overlayTheme}`}
            theme={value.overlayTheme}
            text={sampleOverlayText(value.overlayTheme, sport)}
            inPlayer={false}
          />
        </div>
        <div
          ref={veilRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 opacity-0"
        />
      </button>
      <div className="mt-2" aria-hidden>
        <div
          className="flex h-1.5 gap-1"
          style={{ width: `${Math.round((total / MAX_CUT_SECONDS) * 100)}%` }}
        >
          {shape.map((len, i) => (
            <span
              key={i}
              className="h-full rounded-full bg-lime/70"
              style={{ flexGrow: len, flexBasis: 0 }}
            />
          ))}
        </div>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Sample look · {shape.length} cuts, ~{total}s · tap to replay the{" "}
        {transitionLabel.toLowerCase()}
      </p>
    </div>
  );
}

/**
 * Style preferences the athlete sets *before* uploading: editing vibe, pacing,
 * transitions and overlay theme. The choice is stored on the reel row and
 * drives every AI step (cut list, copy, overlays), so the highlight matches the
 * requested look; the transition and text-card theme also render live in the
 * reel player.
 */
export function ReelStylePanel({
  value,
  onChange,
  disabled,
  sport,
}: {
  value: ReelStylePrefs;
  onChange: (next: ReelStylePrefs) => void;
  disabled?: boolean;
  /** Sport this style applies to — defaults are tuned per sport. */
  sport?: string | null;
}) {
  /** Bumped by the athlete's own transition picks, so only those play the preview. */
  const [demo, setDemo] = useState(0);
  return (
    <section
      className={`mx-5 mb-5 rounded-2xl border border-border bg-surface p-5 ${
        disabled ? "opacity-60" : ""
      }`}
      aria-label="Reel style preferences"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sliders className="h-4 w-4 text-lime" aria-hidden /> Reel style
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Set the look before the AI edits — applied to every new reel you upload.
            {sport ? (
              <>
                {" "}
                Starting points are tuned for{" "}
                <span className="font-semibold text-foreground">{sport}</span>, and tweaks are
                remembered per sport.
              </>
            ) : null}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-lime/40 bg-lime/10 px-2 py-1 text-[10px] font-semibold text-lime">
          {reelStyleSummary(value)}
        </span>
      </div>

      <StylePreview value={value} sport={sport} demo={demo} />

      <div className="mt-4 space-y-4">
        <ChipGroup
          title="Editing vibe"
          hint="How the highlight should feel and sound."
          options={VIBE_OPTIONS}
          value={value.vibe}
          onSelect={(vibe) => onChange({ ...value, vibe })}
        />
        <ChipGroup
          title="Pacing"
          hint="How long the cut runs and how fast it moves."
          options={PACING_OPTIONS}
          value={value.pacing}
          onSelect={(pacing) => onChange({ ...value, pacing })}
        />
        <ChipGroup
          title="Transitions"
          hint="What plays between the AI edit's cuts — you can switch it on any finished reel."
          options={TRANSITION_OPTIONS}
          value={value.transition}
          onSelect={(transition) => {
            onChange({ ...value, transition });
            setDemo((n) => n + 1);
          }}
        />
        <ChipGroup
          title="Overlay theme"
          hint="Wording and look of the on-screen text cards."
          options={OVERLAY_THEME_OPTIONS}
          value={value.overlayTheme}
          onSelect={(overlayTheme) => onChange({ ...value, overlayTheme })}
        />
      </div>
    </section>
  );
}

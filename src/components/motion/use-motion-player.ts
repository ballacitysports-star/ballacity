import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { DEFAULT_FPS, normalizeLoop, stepTime, type PlaybackSpeed } from "@/lib/motion/frames";
import type { Size } from "@/lib/motion/geometry";
import { readVideoFps } from "@/lib/motion/mp4-fps";

export type FpsSource = "file" | "assumed" | "manual";

/** How often the on-screen time may update while playing (it is read every frame, shown less often). */
const TIME_EPSILON = 1 / 40;

export type MotionPlayer = {
  /** Spread onto the <video> element. */
  videoProps: {
    ref: (el: HTMLVideoElement | null) => void;
    src: string | undefined;
    playsInline: true;
    muted: true;
    preload: "auto";
    onLoadedMetadata: (e: SyntheticEvent<HTMLVideoElement>) => void;
    onSeeked: () => void;
    onPlay: () => void;
    onPause: () => void;
    onEnded: () => void;
    onError: () => void;
  };
  video: () => HTMLVideoElement | null;
  src: string | undefined;
  fileName: string;
  duration: number;
  time: number;
  playing: boolean;
  rate: PlaybackSpeed;
  fps: number;
  fpsSource: FpsSource;
  size: Size;
  loopStart: number | null;
  loopEnd: number | null;
  loopOn: boolean;
  /** Counts each time the loop jumped back, so a linked clip can follow. */
  loopWraps: number;
  /** Set when the browser cannot play this file (for example some phone formats). */
  error: string | null;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  step: (frames: number) => void;
  setRate: (r: PlaybackSpeed) => void;
  setFps: (fps: number) => void;
  markLoopStart: () => void;
  markLoopEnd: () => void;
  toggleLoop: () => void;
  clearLoop: () => void;
};

/**
 * Everything about one clip on screen: the on-device file, its real frame rate,
 * where the playhead is, and the loop. The clip is played from a local object URL;
 * nothing is uploaded.
 */
export function useMotionPlayer(file: File | null): MotionPlayer {
  const elRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState<PlaybackSpeed>(1);
  const [fps, setFpsState] = useState(DEFAULT_FPS);
  const [fpsSource, setFpsSource] = useState<FpsSource>("assumed");
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [loopStart, setLoopStart] = useState<number | null>(null);
  const [loopEnd, setLoopEnd] = useState<number | null>(null);
  const [loopOn, setLoopOn] = useState(false);
  const [loopWraps, setLoopWraps] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Latest values for the animation-frame loop, which must not re-subscribe on every tick.
  const live = useRef({ fps, duration, loopStart, loopEnd, loopOn, rate });
  live.current = { fps, duration, loopStart, loopEnd, loopOn, rate };

  // A new file means a new object URL and a clean slate; the old URL is released.
  useEffect(() => {
    setDuration(0);
    setTime(0);
    setPlaying(false);
    setRateState(1);
    setFpsState(DEFAULT_FPS);
    setFpsSource("assumed");
    setSize({ w: 0, h: 0 });
    setLoopStart(null);
    setLoopEnd(null);
    setLoopOn(false);
    setError(null);
    if (!file) {
      setSrc(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setSrc(url);
    let cancelled = false;
    void readVideoFps(file).then((measured) => {
      if (cancelled || measured == null) return;
      setFpsState(measured);
      setFpsSource("file");
    });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const video = useCallback(() => elRef.current, []);

  // Read the playhead every display frame while playing, show it a little less often,
  // and send a loop back to its start the moment it passes its end.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = elRef.current;
      if (v) {
        const { loopStart: a, loopEnd: b, loopOn: on, duration: d, fps: f } = live.current;
        const range = on ? normalizeLoop(a, b, d, f) : null;
        if (range && v.currentTime >= range.end) {
          v.currentTime = range.start;
          setLoopWraps((n) => n + 1);
        }
        setTime((prev) => (Math.abs(prev - v.currentTime) >= TIME_EPSILON ? v.currentTime : prev));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = useCallback((t: number) => {
    const v = elRef.current;
    const { duration: d } = live.current;
    const to = Math.min(Math.max(Number.isFinite(t) ? t : 0, 0), d > 0 ? d : 0);
    if (v) v.currentTime = to;
    setTime(to);
  }, []);

  const play = useCallback(() => {
    const v = elRef.current;
    if (!v) return;
    const { loopStart: a, loopEnd: b, loopOn: on, duration: d, fps: f } = live.current;
    const range = on ? normalizeLoop(a, b, d, f) : null;
    if (range && (v.currentTime < range.start || v.currentTime >= range.end))
      v.currentTime = range.start;
    else if (d > 0 && v.currentTime >= d - 1 / f) v.currentTime = 0;
    v.playbackRate = live.current.rate;
    void v.play()?.catch(() => setPlaying(false));
  }, []);

  const pause = useCallback(() => {
    elRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    const v = elRef.current;
    if (!v) return;
    if (v.paused) play();
    else pause();
  }, [play, pause]);

  const step = useCallback(
    (frames: number) => {
      const v = elRef.current;
      if (!v) return;
      v.pause();
      const { fps: f, duration: d } = live.current;
      seek(stepTime(v.currentTime, frames, f, d));
    },
    [seek],
  );

  const setRate = useCallback((r: PlaybackSpeed) => {
    setRateState(r);
    if (elRef.current) elRef.current.playbackRate = r;
  }, []);

  const setFps = useCallback((n: number) => {
    if (!Number.isFinite(n) || n < 5 || n > 480) return;
    setFpsState(n);
    setFpsSource("manual");
  }, []);

  const markLoopStart = useCallback(() => {
    const t = elRef.current?.currentTime ?? 0;
    setLoopStart(t);
    setLoopOn((on) => on && live.current.loopEnd != null);
  }, []);
  const markLoopEnd = useCallback(() => {
    const t = elRef.current?.currentTime ?? 0;
    setLoopEnd(t);
    if (live.current.loopStart != null) setLoopOn(true);
  }, []);
  const toggleLoop = useCallback(() => {
    const { loopStart: a, loopEnd: b, duration: d, fps: f } = live.current;
    if (!normalizeLoop(a, b, d, f)) return;
    setLoopOn((on) => !on);
  }, []);
  const clearLoop = useCallback(() => {
    setLoopStart(null);
    setLoopEnd(null);
    setLoopOn(false);
  }, []);

  const videoProps = useMemo<MotionPlayer["videoProps"]>(
    () => ({
      ref: (el) => {
        elRef.current = el;
      },
      src,
      playsInline: true,
      muted: true,
      preload: "auto",
      onLoadedMetadata: (e) => {
        const v = e.currentTarget;
        setError(null);
        setDuration(Number.isFinite(v.duration) ? v.duration : 0);
        setSize({ w: v.videoWidth, h: v.videoHeight });
        v.playbackRate = live.current.rate;
        // Show the first frame rather than a black box.
        if (v.currentTime === 0) v.currentTime = 0.0001;
      },
      onSeeked: () => setTime(elRef.current?.currentTime ?? 0),
      onPlay: () => setPlaying(true),
      onPause: () => {
        setPlaying(false);
        setTime(elRef.current?.currentTime ?? 0);
      },
      onEnded: () => setPlaying(false),
      onError: () =>
        setError(
          "This browser can't play that video. Try an MP4 (H.264), or open this page in Safari or Chrome on your phone.",
        ),
    }),
    [src],
  );

  return {
    videoProps,
    video,
    src,
    fileName: file?.name ?? "",
    duration,
    time,
    playing,
    rate,
    fps,
    fpsSource,
    size,
    loopStart,
    loopEnd,
    loopOn,
    loopWraps,
    error,
    toggle,
    play,
    pause,
    seek,
    step,
    setRate,
    setFps,
    markLoopStart,
    markLoopEnd,
    toggleLoop,
    clearLoop,
  };
}

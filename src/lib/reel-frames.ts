/**
 * Browser-side frame + audio capture for uploaded highlight clips.
 *
 * The server runtime can't run ffmpeg, so we sample the clip here at upload
 * time. Those frames become the real thumbnail and the input the sports AI
 * agent "watches"; the extracted audio becomes the transcript the agent reads.
 */

export type CapturedFrame = {
  blob: Blob;
  /** Seconds into the clip this frame was grabbed at. */
  t: number;
};

export type CapturedClip = {
  frames: CapturedFrame[];
  /** Clip duration in seconds (0 when the browser could not report it). */
  duration: number;
  /** 16 kHz mono WAV of the clip's audio, when the browser could decode it. */
  audio: Blob | null;
};

/** Denser sampling for longer clips, capped so uploads stay quick. */
export function frameCountFor(duration: number): number {
  if (!duration || !Number.isFinite(duration)) return 6;
  if (duration <= 8) return 8;
  if (duration <= 20) return 12;
  if (duration <= 45) return 16;
  if (duration <= 90) return 20;
  return 24;
}

function sampleTimes(duration: number, count: number): number[] {
  if (!duration) return [0];
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    // Evenly spaced inside the clip, avoiding the very first/last frame.
    const pct = (i + 0.5) / count;
    times.push(Math.min(Math.max(duration * pct, 0), Math.max(duration - 0.05, 0)));
  }
  return times;
}

async function seekAndGrab(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  time: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", onSeeked);
      resolve(blob);
    };
    const onSeeked = () => {
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish(null);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => finish(b), "image/jpeg", 0.8);
      } catch {
        finish(null);
      }
    };
    video.addEventListener("seeked", onSeeked);
    try {
      video.currentTime = time;
    } catch {
      finish(null);
    }
    setTimeout(() => finish(null), 4000);
  });
}

/** Encodes mono PCM samples as a 16-bit WAV file (what the gateway accepts). */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

const AUDIO_RATE = 16000;
const AUDIO_MAX_SECONDS = 150;

/**
 * Decodes the clip's audio track and downmixes it to 16 kHz mono WAV so it can
 * be transcribed. Returns null for silent/undecodable clips — never throws.
 */
export async function extractAudio(file: File): Promise<Blob | null> {
  try {
    const Ctx: typeof AudioContext | undefined =
      (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (!Ctx) return null;
    const bytes = await file.arrayBuffer();
    const ctx = new Ctx();
    const decoded = await ctx.decodeAudioData(bytes.slice(0));
    await ctx.close().catch(() => {});
    if (!decoded.length) return null;

    const ratio = decoded.sampleRate / AUDIO_RATE;
    const keep = Math.min(decoded.duration, AUDIO_MAX_SECONDS);
    const outLength = Math.floor((keep * decoded.sampleRate) / ratio);
    const out = new Float32Array(outLength);
    const channels: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));

    let peak = 0;
    for (let i = 0; i < outLength; i++) {
      const src = Math.floor(i * ratio);
      let sum = 0;
      for (const ch of channels) sum += ch[src] ?? 0;
      const v = sum / channels.length;
      out[i] = v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    // Effectively silent footage isn't worth a transcription round-trip.
    if (peak < 0.01) return null;
    return encodeWav(out, AUDIO_RATE);
  } catch {
    return null;
  }
}

/**
 * Samples frames (with their real timestamps) plus the audio track.
 * Never throws — degrades to fewer frames / no audio.
 */
export async function captureClip(file: File): Promise<CapturedClip> {
  const empty: CapturedClip = { frames: [], duration: 0, audio: null };
  if (typeof document === "undefined") return empty;
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  video.src = url;

  try {
    const ready = await new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => resolve(ok);
      video.addEventListener("loadeddata", () => done(true), { once: true });
      video.addEventListener("error", () => done(false), { once: true });
      setTimeout(() => done(false), 8000);
    });
    if (!ready || !video.videoWidth) return empty;

    const maxW = 640;
    const scale = Math.min(1, maxW / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const times = sampleTimes(duration, frameCountFor(duration));

    const frames: CapturedFrame[] = [];
    for (const t of times) {
      const blob = await seekAndGrab(video, canvas, t);
      if (blob) frames.push({ blob, t: Math.round(t * 100) / 100 });
    }
    const audio = await extractAudio(file);
    return { frames, duration: Math.round(duration * 100) / 100, audio };
  } catch {
    return empty;
  } finally {
    video.src = "";
    URL.revokeObjectURL(url);
  }
}

/** Back-compat: frames only. */
export async function captureVideoFrames(file: File): Promise<Blob[]> {
  const { frames } = await captureClip(file);
  return frames.map((f) => f.blob);
}

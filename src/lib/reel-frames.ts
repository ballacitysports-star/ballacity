/**
 * Browser-side frame capture for uploaded highlight clips.
 *
 * The server runtime can't run ffmpeg, so we sample frames here at upload time.
 * Those frames become both the real thumbnail and the input the sports AI agent
 * "watches" when it analyses the clip.
 */

const SAMPLE_POSITIONS = [0.12, 0.4, 0.68, 0.9];

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

/** Returns up to 4 JPEG frames sampled evenly across the clip. Never throws. */
export async function captureVideoFrames(file: File): Promise<Blob[]> {
  if (typeof document === "undefined") return [];
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
    if (!ready || !video.videoWidth) return [];

    const maxW = 640;
    const scale = Math.min(1, maxW / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const times = duration
      ? SAMPLE_POSITIONS.map((p) => Math.min(duration - 0.1, Math.max(0, duration * p)))
      : [0];

    const frames: Blob[] = [];
    for (const t of times) {
      const blob = await seekAndGrab(video, canvas, t);
      if (blob) frames.push(blob);
    }
    return frames;
  } catch {
    return [];
  } finally {
    video.src = "";
    URL.revokeObjectURL(url);
  }
}

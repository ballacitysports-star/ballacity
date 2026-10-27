import { visibleAnnotations, type Annotation } from "@/lib/motion/annotations";
import { formatClock, frameNumber } from "@/lib/motion/frames";
import type { Size } from "@/lib/motion/geometry";
import { kinogramCell, kinogramLayout } from "@/lib/motion/kinogram";
import { paintAnnotations, type Ctx2D } from "@/lib/motion/paint";

/** Phones refuse canvases much larger than this; stay well inside. */
const MAX_EDGE = 3840;

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Couldn't make the image."))),
      "image/png",
    );
  });
}

/** Seeks and waits until the picture for that time is ready to draw. */
export function seekTo(video: HTMLVideoElement, t: number, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      reject(new Error("The video took too long to seek."));
    }, timeoutMs);
    const onSeeked = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = t;
  });
}

/** The frame on screen right now, with its drawings, as a PNG at the video's own size (capped). */
export async function renderFrameBlob(
  video: HTMLVideoElement,
  drawings: Annotation[],
  fps: number,
): Promise<Blob> {
  const size: Size = { w: video.videoWidth, h: video.videoHeight };
  if (!(size.w > 0) || !(size.h > 0)) throw new Error("The video isn't ready yet.");
  const scale = Math.min(1, MAX_EDGE / Math.max(size.w, size.h));
  const canvas = canvasOf(size.w * scale, size.h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't make images.");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  paintAnnotations(
    ctx as unknown as Ctx2D,
    visibleAnnotations(drawings, video.currentTime, fps),
    { x: 0, y: 0, w: canvas.width, h: canvas.height },
    size,
  );
  return toBlob(canvas);
}

/**
 * A kinogram sheet: stills at `times`, each with its drawings and a frame label.
 * It reads the clip through a separate hidden video, so the playhead on screen
 * does not move while it works.
 */
export async function renderKinogramBlob(input: {
  src: string;
  times: number[];
  drawings: Annotation[];
  fps: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<Blob> {
  const probe = document.createElement("video");
  probe.muted = true;
  probe.playsInline = true;
  probe.preload = "auto";
  probe.src = input.src;
  // Some phone browsers only decode frames for elements that are in the page.
  Object.assign(probe.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(probe);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("The video didn't load.")), 8000);
      probe.addEventListener(
        "loadeddata",
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      probe.addEventListener(
        "error",
        () => {
          window.clearTimeout(timer);
          reject(new Error("The video couldn't be read."));
        },
        { once: true },
      );
    });
    const size: Size = { w: probe.videoWidth, h: probe.videoHeight };
    if (!(size.w > 0) || !(size.h > 0)) throw new Error("The video isn't ready yet.");
    const cellW = input.times.length >= 10 ? 400 : 480;
    const layout = kinogramLayout(input.times.length, size, cellW);
    const sheet = canvasOf(layout.width, layout.height);
    const ctx = sheet.getContext("2d");
    if (!ctx) throw new Error("This browser can't make images.");
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(0, 0, sheet.width, sheet.height);

    for (let i = 0; i < input.times.length; i += 1) {
      const t = input.times[i];
      await seekTo(probe, t);
      const { x, y } = kinogramCell(layout, i);
      ctx.drawImage(probe, x, y, layout.cellW, layout.cellH);
      const rect = { x, y, w: layout.cellW, h: layout.cellH };
      paintAnnotations(
        ctx as unknown as Ctx2D,
        visibleAnnotations(input.drawings, t, input.fps),
        rect,
        size,
      );
      const tag = `${formatClock(t)}  ·  frame ${frameNumber(t, input.fps)}`;
      ctx.font = `600 ${Math.max(12, layout.cellW / 28)}px system-ui, sans-serif`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      const pad = 6;
      const w = ctx.measureText(tag).width + pad * 2;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(x, y, w, Math.max(12, layout.cellW / 28) + pad * 1.5);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(tag, x + pad, y + pad * 0.75);
      input.onProgress?.(i + 1, input.times.length);
    }
    return await toBlob(sheet);
  } finally {
    probe.removeAttribute("src");
    probe.load();
    probe.remove();
  }
}

/** Opens the phone's share sheet with the image when it can, otherwise downloads it. */
export async function saveOrShareBlob(blob: Blob, filename: string): Promise<"shared" | "saved"> {
  const file = new File([blob], filename, { type: blob.type || "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (
    typeof nav.share === "function" &&
    typeof nav.canShare === "function" &&
    nav.canShare({ files: [file] })
  ) {
    try {
      await nav.share({ files: [file], title: "BallaCity motion review" });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "shared"; // they closed the sheet
      // Anything else: fall through to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "saved";
}

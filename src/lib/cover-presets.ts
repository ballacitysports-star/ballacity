import { imageFor, type Sport } from "@/lib/sample-data";

/**
 * Cover presets are rendered to a real image in the brand look (dark, blue
 * light) at the moment they are picked, then uploaded like any other cover.
 * Storing the rendered file — not the bundled asset URL — keeps saved covers
 * stable when the bundled artwork changes.
 */
const W = 1280;
const H = 720;

export type GradientPreset = { id: string; label: string; stops: [string, string, string] };

export const GRADIENT_PRESETS: GradientPreset[] = [
  { id: "night-blue", label: "Night blue", stops: ["#0b1630", "#0a3a8f", "#00b4ff"] },
  { id: "sunset", label: "Sunset", stops: ["#12070f", "#c2185b", "#f7931e"] },
  { id: "court-lights", label: "Court lights", stops: ["#05060a", "#1b2a6b", "#6d4aff"] },
];

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  return [c, ctx];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load preset image"));
    img.src = src;
  });
}

/** Dark blue wash + vignette so every sport photo sits in the same palette. */
function applyBrandTint(ctx: CanvasRenderingContext2D) {
  ctx.globalCompositeOperation = "multiply";
  const wash = ctx.createLinearGradient(0, 0, W, H);
  wash.addColorStop(0, "#3b6bd6");
  wash.addColorStop(1, "#1b2f73");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
  const fade = ctx.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, "rgba(5,8,20,0.15)");
  fade.addColorStop(1, "rgba(5,8,20,0.55)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, H);
}

export async function renderSportCover(sport: Sport): Promise<string> {
  const img = await loadImage(imageFor(sport));
  const [c, ctx] = canvas();
  const scale = Math.max(W / img.width, H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.filter = "saturate(0.55) brightness(0.9) contrast(1.05)";
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  ctx.filter = "none";
  applyBrandTint(ctx);
  return c.toDataURL("image/jpeg", 0.9);
}

export function renderGradientCover(preset: GradientPreset): string {
  const [c, ctx] = canvas();
  const base = ctx.createLinearGradient(0, H, W, 0);
  base.addColorStop(0, preset.stops[0]);
  base.addColorStop(0.55, preset.stops[1]);
  base.addColorStop(1, preset.stops[2]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.78, H * 0.2, 0, W * 0.78, H * 0.2, W * 0.5);
  glow.addColorStop(0, "rgba(255,255,255,0.22)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // Faint court lines.
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(W * 0.5, H * 1.05, H * 0.55, 0, Math.PI * 2);
  ctx.moveTo(0, H * 0.82);
  ctx.lineTo(W, H * 0.82);
  ctx.stroke();
  return c.toDataURL("image/jpeg", 0.9);
}

/** CSS approximation of {@link renderGradientCover}, for the picker tiles. */
export function gradientCss(preset: GradientPreset): string {
  return `linear-gradient(45deg, ${preset.stops[0]}, ${preset.stops[1]} 55%, ${preset.stops[2]})`;
}

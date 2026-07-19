/**
 * Filter presets and image bake helpers for the advanced image editor.
 *
 * All filters/adjustments are previewed via CSS `filter:` on the live image
 * and then baked into an offscreen canvas via `ctx.filter` on export so the
 * exported file matches the preview (Safari 16+ supports canvas filter).
 */

export type FilterPreset = {
  id: string;
  label: string;
  css: string; // canvas + CSS-compatible filter string, or empty for original
};

export const FILTER_PRESETS: FilterPreset[] = [
  { id: "original", label: "Original", css: "" },
  { id: "mono", label: "Mono", css: "grayscale(1) contrast(1.05)" },
  { id: "warm", label: "Warm", css: "sepia(0.35) saturate(1.15) hue-rotate(-8deg)" },
  { id: "cool", label: "Cool", css: "saturate(1.05) hue-rotate(12deg) brightness(1.02)" },
  { id: "vivid", label: "Vivid", css: "saturate(1.4) contrast(1.12)" },
  { id: "fade", label: "Fade", css: "contrast(0.9) brightness(1.05) saturate(0.85)" },
  { id: "noir", label: "Noir", css: "grayscale(1) contrast(1.35) brightness(0.95)" },
];

export type Adjust = { brightness: number; contrast: number; saturation: number };
export const DEFAULT_ADJUST: Adjust = { brightness: 1, contrast: 1, saturation: 1 };

export function buildFilterString(preset: FilterPreset | undefined, adj: Adjust): string {
  const parts: string[] = [];
  if (preset && preset.css) parts.push(preset.css);
  if (adj.brightness !== 1) parts.push(`brightness(${adj.brightness})`);
  if (adj.contrast !== 1) parts.push(`contrast(${adj.contrast})`);
  if (adj.saturation !== 1) parts.push(`saturate(${adj.saturation})`);
  return parts.join(" ");
}

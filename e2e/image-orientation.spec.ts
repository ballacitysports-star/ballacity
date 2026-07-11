import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Regression: EXIF-tagged photos from iPhone/Android cameras must render
 * upright once passed through the image cropper's normalization pipeline.
 *
 * We exercise the real production module (`src/lib/image-orientation.ts`)
 * via a Vite dev-server import inside the browser, feed it fixture JPEGs
 * with orientation tags 1/3/6/8, and assert:
 *   - dimensions match the upright expectation (200×100)
 *   - the four corners hold the expected quadrant colors
 *     (TL red, TR green, BL blue, BR yellow)
 *
 * A regression that drops EXIF handling will fail loudly here.
 */

type Corners = { tl: number[]; tr: number[]; bl: number[]; br: number[] };
type Diff = { totalPixels: number; mismatched: number; maxChannelDelta: number; meanChannelDelta: number };
type Sample = { w: number; h: number; diff: Diff } & Corners;

const EXPECTED: Corners = {
  tl: [255, 0, 0],
  tr: [0, 255, 0],
  bl: [0, 0, 255],
  br: [255, 255, 0],
};

// Pixel-diff thresholds — tuned for JPEG quantization noise on 200×100 fixtures
// with a hard-edged 4-quadrant reference. A subtle regression (wrong flip axis,
// 1px shift, wrong crop) blows past these instantly because it misplaces
// entire quadrants worth of pixels.
const PER_CHANNEL_TOL = 24;         // absolute delta before a pixel counts as "mismatched"
const MAX_MISMATCH_RATIO = 0.08;    // ≤8% of pixels may exceed PER_CHANNEL_TOL — JPEG chroma-subsampling
                                    // bleeds across the two hard quadrant seams (x=100, y=50)
const MAX_MEAN_CHANNEL_DELTA = 6;   // avg per-channel delta across the whole image — a misplaced
                                    // quadrant would push this to ~60, catching subtle mis-orientation
const TOL = 15; // JPEG quantization noise on 200×100 fixtures

const CASES = [
  { file: "o1.jpg", orientation: 1 },
  { file: "o3.jpg", orientation: 3 },
  { file: "o6.jpg", orientation: 6 },
  { file: "o8.jpg", orientation: 8 },
];

function fixtureBase64(name: string): string {
  const p = join(__dirname, "fixtures", "exif", name);
  return readFileSync(p).toString("base64");
}

function close(a: number[], b: number[]): boolean {
  return a.length >= 3 && b.length >= 3 && [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) <= TOL);
}

test.describe("image orientation normalization", () => {
  test.beforeEach(async ({ page }) => {
    // Any app route works — we just need the Vite dev server to serve the module.
    await page.goto("/", { waitUntil: "domcontentloaded" });
  });

  // Load the upright reference PNG once — passed into each browser evaluate() so
  // we can pixel-diff the normalized output against a known-good bitmap.
  const referenceB64 = readFileSync(
    join(__dirname, "fixtures", "exif", "upright-reference.png"),
  ).toString("base64");

  for (const { file, orientation } of CASES) {
    test(`upright export for EXIF orientation ${orientation} (${file})`, async ({ page }) => {
      const b64 = fixtureBase64(file);

      const result = await page.evaluate(
        async ({ name, b64, refB64, perChannelTol }): Promise<Sample> => {
          // Import the real production module through Vite so this test breaks
          // if the normalization logic is removed or regressed.
          // @ts-expect-error - dev-server module path
          const mod = await import("/src/lib/image-orientation.ts");
          const toBytes = (s: string) => {
            const bin = atob(s);
            const buf = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
            return buf;
          };
          const f = new File([toBytes(b64)], name, { type: "image/jpeg" });
          const dataUrl: string = await mod.loadNormalizedDataUrl(f);

          const decode = (src: string) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const el = new Image();
              el.onload = () => resolve(el);
              el.onerror = () => reject(new Error("decode failed"));
              el.src = src;
            });
          const rasterize = (image: HTMLImageElement) => {
            const c = document.createElement("canvas");
            c.width = image.naturalWidth;
            c.height = image.naturalHeight;
            const cx = c.getContext("2d")!;
            cx.drawImage(image, 0, 0);
            return { canvas: c, ctx: cx, w: c.width, h: c.height };
          };

          const out = rasterize(await decode(dataUrl));
          const ref = rasterize(await decode(`data:image/png;base64,${refB64}`));

          const sample = (x: number, y: number) =>
            Array.from(out.ctx.getImageData(x, y, 1, 1).data).slice(0, 3);

          // Pixel-diff the entire normalized output against the reference.
          let mismatched = 0;
          let maxDelta = 0;
          let sumDelta = 0;
          let samples = 0;
          if (out.w === ref.w && out.h === ref.h) {
            const a = out.ctx.getImageData(0, 0, out.w, out.h).data;
            const b = ref.ctx.getImageData(0, 0, ref.w, ref.h).data;
            for (let i = 0; i < a.length; i += 4) {
              const dr = Math.abs(a[i] - b[i]);
              const dg = Math.abs(a[i + 1] - b[i + 1]);
              const db = Math.abs(a[i + 2] - b[i + 2]);
              const d = Math.max(dr, dg, db);
              if (d > maxDelta) maxDelta = d;
              sumDelta += dr + dg + db;
              samples += 3;
              if (d > perChannelTol) mismatched++;
            }
          } else {
            // Dimension mismatch is itself a regression — surface it via impossible diff.
            mismatched = out.w * out.h;
            maxDelta = 255;
            sumDelta = 255;
            samples = 1;
          }

          return {
            w: out.w,
            h: out.h,
            tl: sample(5, 5),
            tr: sample(out.w - 6, 5),
            bl: sample(5, out.h - 6),
            br: sample(out.w - 6, out.h - 6),
            diff: {
              totalPixels: out.w * out.h,
              mismatched,
              maxChannelDelta: maxDelta,
              meanChannelDelta: sumDelta / samples,
            },
          };
        },
        { name: file, b64, refB64: referenceB64, perChannelTol: PER_CHANNEL_TOL },
      );

      // Upright dimensions: the source is 200×100 regardless of stored orientation.
      expect(result.w, `width for orientation ${orientation}`).toBe(200);
      expect(result.h, `height for orientation ${orientation}`).toBe(100);

      // Corners should match the upright reference regardless of EXIF tag.
      expect(close(result.tl, EXPECTED.tl), `TL for orientation ${orientation}: got ${result.tl}`).toBe(true);
      expect(close(result.tr, EXPECTED.tr), `TR for orientation ${orientation}: got ${result.tr}`).toBe(true);
      expect(close(result.bl, EXPECTED.bl), `BL for orientation ${orientation}: got ${result.bl}`).toBe(true);
      expect(close(result.br, EXPECTED.br), `BR for orientation ${orientation}: got ${result.br}`).toBe(true);

      // Whole-image pixel diff against the upright reference — catches subtle
      // orientation/crop regressions (wrong flip axis, 1px shift, wrong scale)
      // that quadrant sampling would miss.
      const { diff } = result;
      const mismatchRatio = diff.mismatched / diff.totalPixels;
      expect(
        mismatchRatio,
        `orientation ${orientation}: ${diff.mismatched}/${diff.totalPixels} pixels exceed ±${PER_CHANNEL_TOL} (max Δ=${diff.maxChannelDelta}, mean Δ=${diff.meanChannelDelta.toFixed(2)})`,
      ).toBeLessThanOrEqual(MAX_MISMATCH_RATIO);
      expect(
        diff.meanChannelDelta,
        `orientation ${orientation}: mean per-channel delta ${diff.meanChannelDelta.toFixed(2)} exceeds ${MAX_MEAN_CHANNEL_DELTA}`,
      ).toBeLessThanOrEqual(MAX_MEAN_CHANNEL_DELTA);
    });
  }
});


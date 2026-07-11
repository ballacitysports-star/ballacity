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
type Sample = { w: number; h: number } & Corners;

const EXPECTED: Corners = {
  tl: [255, 0, 0],
  tr: [0, 255, 0],
  bl: [0, 0, 255],
  br: [255, 255, 0],
};
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

  for (const { file, orientation } of CASES) {
    test(`upright export for EXIF orientation ${orientation} (${file})`, async ({ page }) => {
      const b64 = fixtureBase64(file);

      const result = await page.evaluate(
        async ({ name, b64 }): Promise<Sample> => {
          // Import the real production module through Vite so this test breaks
          // if the normalization logic is removed or regressed.
          // @ts-expect-error - dev-server module path
          const mod = await import("/src/lib/image-orientation.ts");
          const bin = atob(b64);
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          const f = new File([buf], name, { type: "image/jpeg" });

          const dataUrl: string = await mod.loadNormalizedDataUrl(f);

          // Decode the normalized data URL and sample corner pixels.
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error("decode failed"));
            el.src = dataUrl;
          });
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          const sample = (x: number, y: number) =>
            Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
          const w = canvas.width;
          const h = canvas.height;
          return {
            w, h,
            tl: sample(5, 5),
            tr: sample(w - 6, 5),
            bl: sample(5, h - 6),
            br: sample(w - 6, h - 6),
          };
        },
        { name: file, b64 },
      );

      // Upright dimensions: the source is 200×100 regardless of stored orientation.
      expect(result.w, `width for orientation ${orientation}`).toBe(200);
      expect(result.h, `height for orientation ${orientation}`).toBe(100);

      // Corners should match the upright reference regardless of EXIF tag.
      expect(close(result.tl, EXPECTED.tl), `TL for orientation ${orientation}: got ${result.tl}`).toBe(true);
      expect(close(result.tr, EXPECTED.tr), `TR for orientation ${orientation}: got ${result.tr}`).toBe(true);
      expect(close(result.bl, EXPECTED.bl), `BL for orientation ${orientation}: got ${result.bl}`).toBe(true);
      expect(close(result.br, EXPECTED.br), `BR for orientation ${orientation}: got ${result.br}`).toBe(true);
    });
  }
});

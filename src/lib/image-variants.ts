/**
 * Server-side image variants.
 *
 * Uploaded images live in Storage and are resized **on the server** by the
 * storage image renderer (`/storage/v1/render/image/...`). Nothing is resized
 * in the browser: we only build the URLs that ask the server for a given
 * width/quality, and the CDN caches each variant.
 *
 * Non-storage sources (bundled assets, data URLs, remote avatars) are returned
 * untouched so callers can use these helpers unconditionally.
 */

export type ResizeMode = "cover" | "contain" | "fill";

export type VariantOptions = {
  width: number;
  height?: number;
  /** Defaults to `contain`, which preserves the aspect ratio. */
  resize?: ResizeMode;
  /** 20–100, defaults to 74. */
  quality?: number;
};

/** Responsive widths used for full-bleed / card imagery. */
export const RESPONSIVE_WIDTHS = [320, 480, 640, 960, 1280, 1600] as const;
/** Responsive widths used for avatars and small square thumbs. */
export const AVATAR_WIDTHS = [48, 96, 160, 256, 512] as const;
/** Canonical thumbnail width (grid tiles, gallery strips, message previews). */
export const THUMB_WIDTH = 320;

const PUBLIC_MARKER = "/storage/v1/object/public/";
const SIGNED_MARKER = "/storage/v1/object/sign/";

type Parsed = {
  origin: string;
  kind: "public" | "sign";
  rest: string;
  search: URLSearchParams;
};

function parseStorageUrl(url: string): Parsed | null {
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return null;
  let parsed: URL;
  try {
    parsed = new URL(
      url,
      typeof window === "undefined" ? "http://localhost" : window.location.href,
    );
  } catch {
    return null;
  }
  const path = parsed.pathname;
  const marker = path.includes(PUBLIC_MARKER)
    ? PUBLIC_MARKER
    : path.includes(SIGNED_MARKER)
      ? SIGNED_MARKER
      : null;
  if (!marker) return null;
  const rest = path.slice(path.indexOf(marker) + marker.length);
  if (!rest) return null;
  return {
    origin: parsed.origin,
    kind: marker === PUBLIC_MARKER ? "public" : "sign",
    rest,
    search: parsed.searchParams,
  };
}

/** True when the URL points at an image we can ask the server to resize. */
export function isTransformableImageUrl(url: string | null | undefined): boolean {
  return !!url && parseStorageUrl(url) !== null;
}

/**
 * Build a server-rendered variant of a stored image. Returns the original URL
 * unchanged when it is not a Storage object.
 */
export function imageVariant(
  url: string | null | undefined,
  { width, height, resize = "contain", quality = 74 }: VariantOptions,
): string {
  if (!url) return "";
  const parsed = parseStorageUrl(url);
  if (!parsed) return url;

  const params = new URLSearchParams();
  const token = parsed.search.get("token");
  if (parsed.kind === "sign" && token) params.set("token", token);
  params.set("width", String(Math.max(1, Math.round(width))));
  if (height) params.set("height", String(Math.max(1, Math.round(height))));
  params.set("resize", resize);
  params.set("quality", String(Math.min(100, Math.max(20, Math.round(quality)))));

  return `${parsed.origin}/storage/v1/render/image/${parsed.kind}/${parsed.rest}?${params.toString()}`;
}

/** Square thumbnail (cropped) — avatars, gallery tiles, message previews. */
export function imageThumb(url: string | null | undefined, size = THUMB_WIDTH): string {
  return imageVariant(url, { width: size, height: size, resize: "cover" });
}

/**
 * Build a `srcSet` string for the given widths, skipping any wider than the
 * largest useful render. Returns `undefined` for non-storage URLs so callers
 * can spread it onto an `<img>` safely.
 */
export function imageSrcSet(
  url: string | null | undefined,
  widths: readonly number[] = RESPONSIVE_WIDTHS,
  options: { aspect?: number; resize?: ResizeMode; quality?: number } = {},
): string | undefined {
  if (!isTransformableImageUrl(url)) return undefined;
  const { aspect, resize, quality } = options;
  return widths
    .map((w) => {
      const height = aspect ? Math.round(w / aspect) : undefined;
      const variant = imageVariant(url, {
        width: w,
        ...(height ? { height } : {}),
        resize: resize ?? (aspect ? "cover" : "contain"),
        ...(quality ? { quality } : {}),
      });
      return `${variant} ${w}w`;
    })
    .join(", ");
}

/**
 * Ask the server to render (and the CDN to cache) the common variants for a
 * freshly uploaded image. Fire-and-forget: failures never block the upload.
 */
export function warmImageVariants(
  url: string,
  widths: readonly number[] = RESPONSIVE_WIDTHS,
): void {
  if (typeof fetch !== "function" || !isTransformableImageUrl(url)) return;
  const targets = [imageThumb(url), ...widths.map((w) => imageVariant(url, { width: w }))];
  for (const target of targets) {
    void fetch(target, { method: "GET", mode: "cors", cache: "force-cache" }).catch(() => {});
  }
}

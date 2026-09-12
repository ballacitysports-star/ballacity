import * as React from "react";
import type { ImgHTMLAttributes } from "react";
import {
  AVATAR_WIDTHS,
  RESPONSIVE_WIDTHS,
  imageSrcSet,
  imageVariant,
  type ResizeMode,
} from "@/lib/image-variants";
import { useBlockedImage } from "@/lib/blocked-images";
import { useMediaUrl } from "@/hooks/use-media-url";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "srcSet" | "onError" | "src"> & {
  src: string | null | undefined;
  /** Rendered CSS width hint used for `sizes` (default `100vw`). */
  sizes?: string;
  /** Widths offered to the browser; defaults to the responsive set. */
  widths?: readonly number[];
  /** Width/height ratio — when set, variants are cropped to it. */
  aspect?: number;
  resize?: ResizeMode;
  quality?: number;
  /** Fallback width used for the `src` attribute. */
  baseWidth?: number;
  /**
   * Fired once retries are exhausted and the image could not be loaded, so
   * the caller can swap to a fallback instead of leaving a broken image.
   */
  onLoadError?: () => void;
};

const MAX_IMAGE_ATTEMPTS = 3;

/**
 * `<img>` that serves server-generated, CDN-cached variants of a stored image
 * via `srcSet`. Non-storage sources (bundled assets, data URLs) pass through.
 *
 * Self-heals through slow or flaky image delivery the same way
 * `UserAvatar`'s `RetryingAvatarImage` does: a failed load is retried with
 * backoff (cache-busted) a couple of times before `onLoadError` fires and the
 * caller is expected to fall back to other content.
 */
export function ResponsiveImage({
  src,
  sizes = "100vw",
  widths = RESPONSIVE_WIDTHS,
  aspect,
  resize,
  quality,
  baseWidth,
  loading = "lazy",
  decoding = "async",
  alt = "",
  onLoadError,
  ...rest
}: Props) {
  const blocked = useBlockedImage(src);
  // Private media is stored as a reference; swap it for a short-lived signed URL
  // before building variants (and render nothing when unauthorised).
  const resolved = useMediaUrl(src);

  const [attempt, setAttempt] = React.useState(0);
  const [dead, setDead] = React.useState(false);
  React.useEffect(() => {
    setAttempt(0);
    setDead(false);
  }, [resolved]);

  if (!resolved || blocked || dead) return null;
  src = resolved;
  const fallbackWidth = baseWidth ?? widths[Math.max(0, widths.length - 2)] ?? 960;
  const variant = imageVariant(src, {
    width: fallbackWidth,
    ...(aspect ? { height: Math.round(fallbackWidth / aspect) } : {}),
    resize: resize ?? (aspect ? "cover" : "contain"),
    ...(quality ? { quality } : {}),
  });
  const base =
    attempt === 0 ? variant : `${variant}${variant.includes("?") ? "&" : "?"}retry=${attempt}`;
  // srcSet (when present) wins over `src` in the browser, which would make the
  // cache-busted retry above pointless — a retry must win an exclusive shot at
  // a fresh request, so `srcSet` sits out once one is in flight.
  const srcSet =
    attempt === 0
      ? imageSrcSet(src, widths, {
          ...(aspect ? { aspect } : {}),
          ...(resize ? { resize } : {}),
          ...(quality ? { quality } : {}),
        })
      : undefined;

  return (
    <img
      key={base}
      src={base}
      {...(srcSet ? { srcSet, sizes } : {})}
      alt={alt}
      loading={loading}
      decoding={decoding}
      onError={() => {
        if (attempt + 1 >= MAX_IMAGE_ATTEMPTS) {
          setDead(true);
          onLoadError?.();
          return;
        }
        const next = attempt + 1;
        window.setTimeout(() => setAttempt(next), 400 * next);
      }}
      {...rest}
    />
  );
}

/** Square, server-cropped avatar image. */
export function ResponsiveAvatar({
  src,
  size = 96,
  ...rest
}: Omit<Props, "aspect" | "widths" | "sizes"> & { size?: number }) {
  return (
    <ResponsiveImage
      src={src}
      aspect={1}
      resize="cover"
      widths={AVATAR_WIDTHS}
      sizes={`${size}px`}
      baseWidth={size * 2}
      {...rest}
    />
  );
}

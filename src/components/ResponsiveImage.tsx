import type { ImgHTMLAttributes } from "react";
import {
  AVATAR_WIDTHS,
  RESPONSIVE_WIDTHS,
  imageSrcSet,
  imageVariant,
  type ResizeMode,
} from "@/lib/image-variants";
import { useBlockedImage } from "@/lib/blocked-images";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "srcSet"> & {
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
};

/**
 * `<img>` that serves server-generated, CDN-cached variants of a stored image
 * via `srcSet`. Non-storage sources (bundled assets, data URLs) pass through.
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
  ...rest
}: Props) {
  const blocked = useBlockedImage(src);
  // Private media is stored as a reference; swap it for a short-lived signed URL
  // before building variants (and render nothing when unauthorised).
  const resolved = useMediaUrl(src);
  if (!resolved || blocked) return null;
  src = resolved;
  const fallbackWidth = baseWidth ?? widths[Math.max(0, widths.length - 2)] ?? 960;
  const base = imageVariant(src, {
    width: fallbackWidth,
    ...(aspect ? { height: Math.round(fallbackWidth / aspect) } : {}),
    resize: resize ?? (aspect ? "cover" : "contain"),
    ...(quality ? { quality } : {}),
  });
  const srcSet = imageSrcSet(src, widths, {
    ...(aspect ? { aspect } : {}),
    ...(resize ? { resize } : {}),
    ...(quality ? { quality } : {}),
  });

  return (
    <img
      src={base}
      {...(srcSet ? { srcSet, sizes } : {})}
      alt={alt}
      loading={loading}
      decoding={decoding}
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

import { useMediaUrl } from "@/hooks/use-media-url";

type MediaImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | null | undefined;
  /** Rendered while a private reference is being signed. */
  fallbackSrc?: string;
};

/**
 * `<img>` for values that may be a private media reference. Public URLs render
 * immediately; private references (`storage://bucket/path`) render once a
 * short-lived signed URL has been minted for the current viewer, and stay blank
 * when the viewer is not allowed to see them.
 */
export function MediaImage({ src, fallbackSrc, alt = "", ...rest }: MediaImageProps) {
  const resolved = useMediaUrl(src);
  const url = resolved ?? fallbackSrc;
  if (!url) return null;
  return <img {...rest} src={url} alt={alt} />;
}

export default MediaImage;

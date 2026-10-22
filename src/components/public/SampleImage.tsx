import { sampleImageForSport } from "@/lib/sample-data";

/**
 * A stock photo for a sport, standing in for a listing's own picture on public
 * pages. It is decoration, never the listing's real photo, so a banner says so
 * ("Sample image") and thumbnails are hidden from screen readers.
 */
export function SampleImage({
  sport,
  className = "",
  caption = false,
}: {
  sport: string | null | undefined;
  className?: string;
  /** Show the "Sample image" label; used on banners, left off small thumbnails. */
  caption?: boolean;
}) {
  return (
    <figure className={`relative overflow-hidden bg-secondary ${className}`}>
      <img
        src={sampleImageForSport(sport)}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
      {caption ? (
        <figcaption className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-semibold text-white">
          Sample image
        </figcaption>
      ) : null}
    </figure>
  );
}

import { ImageUploader } from "@/components/ImageUploader";
import type { ImageBucket } from "@/lib/image-upload";

/**
 * One control for a team's or trainer's mark: the logo/photo uploader plus, only
 * while there is no image, a small initials input as the fallback.
 *
 * The logo and the initials are separate values, so removing the image brings
 * the initials straight back and uploading one never overwrites the other.
 */
export function LogoWithInitialsField({
  logoUrl,
  onLogoChange,
  initials,
  onInitialsChange,
  defaultInitials,
  bucket,
  pathPrefix,
  logo = false,
  label,
}: {
  /** The uploaded image URL, or "" for none. */
  logoUrl: string;
  onLogoChange: (url: string) => void;
  /** Up to 3 initials, or "" to use the default. */
  initials: string;
  onInitialsChange: (initials: string) => void;
  /** Shown as the placeholder, e.g. initials of the team name. */
  defaultInitials: string;
  bucket: ImageBucket;
  pathPrefix: string | null | undefined;
  /** Team/org logo (square, fitted) rather than a person's photo. */
  logo?: boolean;
  label?: string;
}) {
  const hasImage = !!logoUrl;
  return (
    <div className="space-y-3">
      <ImageUploader
        kind="avatar"
        logo={logo}
        bucket={bucket}
        pathPrefix={pathPrefix}
        value={logoUrl}
        onChange={onLogoChange}
        onClear={() => onLogoChange("")}
        label={label}
      />
      {!hasImage && (
        <label className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Or use initials</span>
            <span className="block text-[11px] text-muted-foreground">
              Shown until you add a {logo ? "logo" : "photo"}.
            </span>
          </span>
          <input
            value={initials}
            onChange={(e) => onInitialsChange(e.target.value.toUpperCase().slice(0, 3))}
            placeholder={defaultInitials}
            maxLength={3}
            aria-label="Initials"
            className="w-20 shrink-0 rounded-xl border border-border bg-background px-2 py-2 text-center font-display text-lg font-bold uppercase tracking-widest outline-none focus:border-lime"
          />
        </label>
      )}
    </div>
  );
}

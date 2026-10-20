import { ImageUploader } from "@/components/ImageUploader";
import { isImageUrl } from "@/components/OrgAvatarMark";
import type { ImageBucket } from "@/lib/image-upload";

/**
 * One control for a team's or trainer's mark. Teams keep either an uploaded
 * logo URL or short initials in the same `avatar` field, so this shows the
 * uploader and — only while no image is set — a small initials input as the
 * fallback. Removing the image brings the initials back.
 */
export function LogoWithInitialsField({
  value,
  onChange,
  defaultInitials,
  bucket,
  pathPrefix,
  logo = false,
  label,
}: {
  /** The shared `avatar` value: an image URL or up to 3 initials. */
  value: string;
  onChange: (value: string) => void;
  /** Shown as the placeholder, e.g. initials of the team name. */
  defaultInitials: string;
  bucket: ImageBucket;
  pathPrefix: string | null | undefined;
  /** Team/org logo (square, fitted) rather than a person's photo. */
  logo?: boolean;
  label?: string;
}) {
  const hasImage = isImageUrl(value);
  return (
    <div className="space-y-3">
      <ImageUploader
        kind="avatar"
        logo={logo}
        bucket={bucket}
        pathPrefix={pathPrefix}
        value={hasImage ? value : ""}
        onChange={onChange}
        onClear={() => onChange("")}
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
            value={value}
            onChange={(e) => onChange(e.target.value.toUpperCase().slice(0, 3))}
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

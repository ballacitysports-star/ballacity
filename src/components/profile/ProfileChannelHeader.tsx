import * as React from "react";
import { ResponsiveAvatar, ResponsiveImage } from "@/components/ResponsiveImage";

/**
 * YouTube channel-page header: short rounded banner, large avatar, name, a
 * single muted meta line, a one-line description with a "...more" affordance,
 * and a horizontal pill action row.
 *
 * Shared by my own profile and public player profiles so the two can't drift.
 */
export function ProfileChannelHeader({
  bannerUrl,
  bannerOverlay,
  avatarUrl,
  avatarFallback,
  name,
  nameBadge,
  meta,
  description,
  onOpenAbout,
  actions,
}: {
  bannerUrl?: string | null;
  /** Rendered in the banner's top-right (settings gear, back button, etc). */
  bannerOverlay?: React.ReactNode;
  avatarUrl?: string | null;
  avatarFallback: React.ReactNode;
  name: string;
  nameBadge?: React.ReactNode;
  /** Pieces joined with a middot on one muted line, YouTube-style. */
  meta: React.ReactNode[];
  description?: string | null;
  onOpenAbout?: () => void;
  actions?: React.ReactNode;
}) {
  const parts = meta.filter(Boolean);
  const [avatarFailed, setAvatarFailed] = React.useState(false);
  React.useEffect(() => {
    setAvatarFailed(false);
  }, [avatarUrl]);
  return (
    <header>
      {/* Banner — full-bleed, 176px tall, heavy fade into the page background */}
      <div className="relative h-44 w-full overflow-hidden bg-surface">
        {bannerUrl && (
          <ResponsiveImage
            src={bannerUrl}
            alt=""
            aspect={16 / 5}
            sizes="100vw"
            baseWidth={1280}
            className="h-full w-full object-cover"
          />
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-background/60 to-background"
        />
        {bannerOverlay && (
          <div className="absolute right-3 top-3 flex items-center gap-2">{bannerOverlay}</div>
        )}
      </div>

      {/* Identity */}
      <div className="px-4 pt-4">
        <div className="flex items-start gap-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2 text-2xl font-bold">
            {avatarUrl && !avatarFailed ? (
              <ResponsiveAvatar
                src={avatarUrl}
                size={80}
                alt={name}
                className="h-full w-full object-cover"
                onLoadError={() => setAvatarFailed(true)}
              />
            ) : (
              avatarFallback
            )}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-bold leading-tight">
              <span className="min-w-0 break-words">{name}</span>
              {nameBadge}
            </h1>
            {parts.length > 0 && (
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                {parts.map((p, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span aria-hidden> · </span>}
                    {p}
                  </React.Fragment>
                ))}
              </p>
            )}
            {onOpenAbout && (
              <button
                type="button"
                onClick={onOpenAbout}
                className="mt-1 flex max-w-full items-baseline gap-1 text-left text-[13px] text-muted-foreground"
              >
                <span className="line-clamp-1 min-w-0 break-words">
                  {description?.trim() ? description : "Tap for more about this profile"}
                </span>
                <span className="shrink-0 text-[13px] font-medium text-foreground">...more</span>
              </button>
            )}
          </div>
        </div>

        {actions && (
          <div className="scrollbar-hide -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

/** YouTube-style action pill. `variant="primary"` is the filled Subscribe-like pill. */
export function ChannelPill({
  variant = "outline",
  className = "",
  ...rest
}: {
  variant?: "primary" | "outline";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...rest} className={`${channelPillClass(variant)} ${className}`} />;
}

export function channelPillClass(variant: "primary" | "outline" = "outline") {
  return `inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:opacity-90"
      : "bg-surface-2 text-foreground hover:bg-surface"
  }`;
}

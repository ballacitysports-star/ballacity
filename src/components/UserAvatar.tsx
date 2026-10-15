import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMyProfile } from "@/lib/user-prefs-store";
import { useActiveProfile } from "@/lib/account-profiles";
import { useUserAvatar } from "@/lib/user-avatars";
import { cn } from "@/lib/utils";

export type UserAvatarSize = "xs" | "sm" | "md" | "lg";

type Props = {
  avatarUrl?: string | null;
  initials?: string | null;
  name?: string | null;
  size?: UserAvatarSize;
  className?: string;
  ringWhenActive?: boolean;
  active?: boolean;
  rounded?: "full" | "square";
  /** Show a shimmering placeholder while the avatar record is still resolving. */
  loading?: boolean;
  /** Lookup failed — renders a tappable retry affordance. */
  error?: boolean;
  onRetry?: () => void;
};

const SIZE_MAP: Record<UserAvatarSize, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
};

const ICON_MAP: Record<UserAvatarSize, string> = {
  xs: "h-3 w-3",
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};

function toInitials(name?: string | null, initials?: string | null): string {
  if (initials && initials.trim()) return initials.trim().slice(0, 2).toUpperCase();
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return "";
}

const MAX_IMAGE_ATTEMPTS = 3;

/**
 * Avatar photo that self-heals through slow or flaky image delivery: a failed
 * load is retried with backoff (cache-busted) a couple of times before we give
 * up and let the initials fallback show.
 */
function RetryingAvatarImage({ src, alt }: { src: string; alt: string }) {
  const [attempt, setAttempt] = React.useState(0);
  const [dead, setDead] = React.useState(false);

  React.useEffect(() => {
    setAttempt(0);
    setDead(false);
  }, [src]);

  if (dead) return null;

  const url = attempt === 0 ? src : `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}`;

  return (
    <AvatarImage
      key={url}
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (attempt + 1 >= MAX_IMAGE_ATTEMPTS) {
          setDead(true);
          return;
        }
        const next = attempt + 1;
        window.setTimeout(() => setAttempt(next), 400 * next);
      }}
    />
  );
}

/**
 * Generic user avatar. Renders the uploaded photo when present, otherwise
 * initials on a lime-tinted circle. Shows a skeleton while loading and a
 * retry affordance when the lookup failed.
 */
export function UserAvatar({
  avatarUrl,
  initials,
  name,
  size = "xs",
  className,
  ringWhenActive,
  active,
  rounded = "full",
  loading,
  error,
  onRetry,
}: Props) {
  const label = toInitials(name, initials);
  const shape = rounded === "square" ? "rounded-2xl" : "rounded-full";
  const frame = cn(
    SIZE_MAP[size],
    shape,
    "border border-border/60",
    ringWhenActive && active && "ring-2 ring-lime ring-offset-1 ring-offset-surface",
    className,
  );

  if (error && !label && !avatarUrl) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRetry?.();
        }}
        aria-label="Retry loading avatar"
        title="Couldn't load photo — tap to retry"
        className={cn(
          frame,
          "grid place-items-center bg-secondary/60 text-muted-foreground hover:text-lime",
        )}
      >
        <RefreshCw className={ICON_MAP[size]} aria-hidden />
      </button>
    );
  }

  if (loading && !label && !avatarUrl) {
    return (
      <div
        role="status"
        aria-label="Loading avatar"
        className={cn(frame, "animate-pulse bg-secondary/60")}
      />
    );
  }

  return (
    <Avatar className={frame}>
      {avatarUrl ? <RetryingAvatarImage src={avatarUrl} alt={name ?? "User avatar"} /> : null}
      <AvatarFallback
        className={cn(
          shape,
          "font-semibold text-foreground",
          label ? "bg-lime/20" : "bg-secondary/60",
          loading && !label && "animate-pulse",
        )}
      >
        {label || (
          <span aria-hidden className="block h-2 w-2 rounded-full bg-muted-foreground/50" />
        )}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Renders any user's avatar by auth user id — resolves their photo from the
 * shared privacy-aware avatar cache and falls back to the passed-in
 * name/initials (e.g. a game's host snapshot) until it loads.
 */
export function UserAvatarById({ userId, ...props }: Props & { userId?: string | null }) {
  const resolved = useUserAvatar(userId);
  return (
    <UserAvatar
      {...props}
      avatarUrl={resolved.avatarUrl ?? props.avatarUrl ?? null}
      initials={resolved.initials ?? props.initials}
      name={resolved.name ?? props.name}
      loading={props.loading ?? resolved.status === "loading"}
      error={props.error ?? resolved.status === "error"}
      onRetry={props.onRetry ?? resolved.retry}
    />
  );
}

/**
 * Convenience: renders the signed-in user's avatar. Safe to use during
 * hydration — falls through to the neutral placeholder until the profile
 * has loaded. When acting as a team, trainer or gym profile, shows that
 * profile's logo instead of the personal photo.
 */
export function MyAvatar(props: Omit<Props, "avatarUrl" | "initials" | "name">) {
  const me = useMyProfile();
  const { active } = useActiveProfile();
  const useLogo = !!active && active.kind !== "player";
  return (
    <UserAvatar
      avatarUrl={useLogo ? active.avatarUrl : me?.avatarUrl}
      initials={useLogo ? active.avatarFallback : me?.avatar}
      name={useLogo ? active.name : me?.name}
      loading={!me}
      {...props}
    />
  );
}

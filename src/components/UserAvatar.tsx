import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMyProfile } from "@/lib/user-prefs-store";
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
};

const SIZE_MAP: Record<UserAvatarSize, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
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

/**
 * Generic user avatar. Renders the uploaded photo when present, otherwise
 * initials on a lime-tinted circle. Falls back to a neutral placeholder
 * when neither photo nor initials are known yet (loading state).
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
}: Props) {
  const label = toInitials(name, initials);
  const shape = rounded === "square" ? "rounded-2xl" : "rounded-full";
  return (
    <Avatar
      className={cn(
        SIZE_MAP[size],
        shape,
        "border border-border/60",
        ringWhenActive && active && "ring-2 ring-lime ring-offset-1 ring-offset-surface",
        className,
      )}
    >
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name ?? "User avatar"} /> : null}
      <AvatarFallback
        className={cn(
          shape,
          "font-semibold text-foreground",
          label ? "bg-lime/20" : "bg-secondary/60",
        )}
      >
        {label || <span aria-hidden className="block h-2 w-2 rounded-full bg-muted-foreground/50" />}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Renders any user's avatar by auth user id — resolves their uploaded photo
 * from the shared avatar cache and falls back to the passed-in name/initials
 * (e.g. a game's host snapshot) until it loads.
 */
export function UserAvatarById({
  userId,
  ...props
}: Props & { userId?: string | null }) {
  const resolved = useUserAvatar(userId);
  return (
    <UserAvatar
      {...props}
      avatarUrl={resolved?.avatarUrl ?? props.avatarUrl ?? null}
      initials={resolved?.initials ?? props.initials}
      name={resolved?.name ?? props.name}
    />
  );
}

/**
 * Convenience: renders the signed-in user's avatar. Safe to use during
 * hydration — falls through to the neutral placeholder until the profile
 * has loaded.
 */
export function MyAvatar(props: Omit<Props, "avatarUrl" | "initials" | "name">) {
  const me = useMyProfile();
  return (
    <UserAvatar
      avatarUrl={me?.avatarUrl}
      initials={me?.avatar}
      name={me?.name}
      {...props}
    />
  );
}

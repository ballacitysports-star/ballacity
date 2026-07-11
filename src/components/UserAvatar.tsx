import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMyProfile } from "@/lib/user-prefs-store";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  ringWhenActive?: boolean;
  active?: boolean;
};

/**
 * Renders the signed-in user's avatar (uploaded image, else initials).
 * Falls back to a neutral placeholder when the profile hasn't loaded yet.
 */
export function UserAvatar({ className, ringWhenActive, active }: Props) {
  const me = useMyProfile();
  const initials = (me?.avatar || me?.name?.slice(0, 2) || "?").toUpperCase();
  return (
    <Avatar
      className={cn(
        "h-6 w-6 border border-border/60",
        ringWhenActive && active && "ring-2 ring-lime ring-offset-1 ring-offset-surface",
        className,
      )}
    >
      {me?.avatarUrl ? (
        <AvatarImage src={me.avatarUrl} alt={me.name ?? "You"} />
      ) : null}
      <AvatarFallback className="bg-lime/20 text-[10px] font-semibold text-foreground">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

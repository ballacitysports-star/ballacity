import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/UserAvatar";
import { listFollows, type FollowListKind } from "@/lib/follows";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  displayName: string;
  kind: FollowListKind;
};

export function FollowListDialog({ open, onOpenChange, userId, displayName, kind }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["follow-list", kind, userId],
    queryFn: () => listFollows(userId, kind),
    enabled: open,
    staleTime: 15_000,
  });

  const title = kind === "followers" ? "Followers" : "Following";
  const emptyLabel =
    kind === "followers"
      ? `${displayName} has no followers yet.`
      : `${displayName} isn't following anyone yet.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto p-0 sm:max-w-md">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>
            {title}
            {typeof data?.length === "number" && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {data.length}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {kind === "followers"
              ? `People following ${displayName}.`
              : `People ${displayName} follows.`}
          </DialogDescription>
        </DialogHeader>
        <div className="px-3 pb-4 pt-2">
          {isLoading ? (
            <div className="grid place-items-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : isError ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Couldn't load list.
            </p>
          ) : !data || data.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.map((u) => (
                <li key={u.id}>
                  <Link
                    to="/players/$userId"
                    params={{ userId: u.id }}
                    onClick={() => onOpenChange(false)}
                    className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface/60"
                  >
                    <UserAvatar
                      avatarUrl={u.avatar_url}
                      initials={u.avatar_initials}
                      name={u.display_name}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{u.display_name}</div>
                      {u.username && (
                        <div className="truncate text-xs text-muted-foreground">
                          @{u.username.replace(/^@/, "")}
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

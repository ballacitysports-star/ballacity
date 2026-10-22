import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, MoreHorizontal, Search, ShieldOff, Flag, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { UserAvatar } from "@/components/UserAvatar";
import { usePrefetchUserAvatars } from "@/lib/user-avatars";

import { ReportUserDialog } from "@/components/ReportUserDialog";
import { useAuth } from "@/hooks/use-auth";
import { useBlock } from "@/lib/moderation";
import {
  listFollows,
  followUser,
  unfollowUser,
  FOLLOW_PAGE_SIZE,
  type FollowListKind,
  type FollowPage,
  type FollowUser,
} from "@/lib/follows";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  displayName: string;
  initialTab: FollowListKind;
};

export function FollowSheet({ open, onOpenChange, userId, displayName, initialTab }: Props) {
  const [tab, setTab] = useState<FollowListKind>(initialTab);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setQuery("");
    }
  }, [open, initialTab]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-center text-base font-bold">{displayName}</DialogTitle>
          <DialogDescription className="sr-only">
            Followers and following for {displayName}.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as FollowListKind)}>
          <TabsList className="grid w-full grid-cols-2 rounded-none border-b border-border bg-transparent p-0">
            <TabsTrigger
              value="followers"
              className="rounded-none border-b-2 border-transparent bg-transparent py-3 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Followers
            </TabsTrigger>
            <TabsTrigger
              value="following"
              className="rounded-none border-b-2 border-transparent bg-transparent py-3 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Following
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="border-b border-border px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="h-9 rounded-full bg-surface pl-9 pr-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <FollowList
          userId={userId}
          kind={tab}
          query={query}
          onNavigate={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function FollowList({
  userId,
  kind,
  query,
  onNavigate,
}: {
  userId: string;
  kind: FollowListKind;
  query: string;
  onNavigate: () => void;
}) {
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery<FollowPage>({
      queryKey: ["follow-list", kind, userId, viewerId],
      queryFn: ({ pageParam }) =>
        listFollows(userId, kind, (pageParam as string | null) ?? null, FOLLOW_PAGE_SIZE, viewerId),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.nextCursor,
      staleTime: 15_000,
    });

  const users = useMemo(() => data?.pages.flatMap((p) => p.users) ?? [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.display_name.toLowerCase().includes(q) || (u.username ?? "").toLowerCase().includes(q),
    );
  }, [users, query]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Search results: first rows urgent, the rest speculative.
  const ids = filtered.map((u) => u.id);
  usePrefetchUserAvatars(ids.slice(0, 10), "high");
  usePrefetchUserAvatars(ids.slice(10), "low");

  return (
    <div className="max-h-[60dvh] overflow-y-auto px-2 pb-3 pt-1">
      {isLoading ? (
        <div className="grid place-items-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : isError ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Couldn't load list.</p>
      ) : users.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          {kind === "followers" ? "No followers yet." : "Not following anyone yet."}
        </p>
      ) : filtered.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No matches.</p>
      ) : (
        <ul>
          {filtered.map((u) => (
            <FollowRow
              key={u.id}
              user={u}
              viewerId={viewerId}
              onNavigate={onNavigate}
              listKey={["follow-list", kind, userId, viewerId]}
            />
          ))}
        </ul>
      )}
      <div ref={sentinelRef} className="h-8" />
      {isFetchingNextPage && (
        <div className="grid place-items-center py-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
    </div>
  );
}

function FollowRow({
  user,
  viewerId,
  onNavigate,
  listKey,
}: {
  user: FollowUser;
  viewerId: string | null;
  onNavigate: () => void;
  listKey: unknown[];
}) {
  const qc = useQueryClient();
  const isSelf = viewerId === user.id;
  const [optimisticFollows, setOptimisticFollows] = useState<boolean | null>(null);
  const isFollowing = optimisticFollows ?? user.viewerFollows;

  const mutation = useMutation({
    mutationFn: async () => {
      if (isFollowing) {
        await unfollowUser(user.id);
        return "unfollowed" as const;
      }
      return followUser(user.id);
    },
    onMutate: () => {
      setOptimisticFollows(!isFollowing);
    },
    onSuccess: (outcome) => {
      // An account that needs approval only gets a request, not a follow.
      if (outcome === "requested") {
        setOptimisticFollows(false);
        toast.success("Follow request sent");
      }
    },
    onError: (e: any) => {
      setOptimisticFollows(isFollowing);
      toast.error(e?.message ?? "Something went wrong");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: ["follow", user.id] });
    },
  });

  return (
    <li className="flex items-center gap-3 rounded-xl px-2 py-2.5">
      <Link
        to="/players/$userId"
        params={{ userId: user.id }}
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <UserAvatar
          avatarUrl={user.avatar_url}
          initials={user.avatar_initials}
          name={user.display_name}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{user.display_name}</span>
            {!isSelf && viewerId && user.viewerFollows && (
              <span
                className="shrink-0 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                title="You also follow this user"
              >
                Mutual
              </span>
            )}
          </div>
          {user.username && (
            <div className="truncate text-xs text-muted-foreground">
              @{user.username.replace(/^@/, "")}
            </div>
          )}
        </div>
      </Link>
      {!isSelf && viewerId && (
        <>
          <Button
            size="sm"
            variant={isFollowing ? "outline" : "default"}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            className={
              isFollowing
                ? "h-8 rounded-full border-border bg-surface px-4 text-xs font-semibold"
                : "h-8 rounded-full bg-lime-gradient px-4 text-xs font-semibold text-primary-foreground"
            }
          >
            {isFollowing ? "Following" : "Follow"}
          </Button>
          <UserSafetyMenu userId={user.id} displayName={user.display_name} />
        </>
      )}
    </li>
  );
}

export function UserSafetyMenu({
  userId,
  displayName,
  align = "end",
}: {
  userId: string;
  displayName: string;
  align?: "start" | "center" | "end";
}) {
  const block = useBlock(userId);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  async function handleBlockConfirmed() {
    try {
      await block.toggle();
      toast.success(block.blocked ? `${displayName} unblocked` : `${displayName} blocked`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update block");
    } finally {
      setConfirmBlock(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full text-muted-foreground"
            aria-label={`More options for ${displayName}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-48">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              if (block.blocked) {
                void handleBlockConfirmed();
              } else {
                setConfirmBlock(true);
              }
            }}
            disabled={block.pending}
            className="text-destructive focus:text-destructive"
          >
            <ShieldOff className="mr-2 h-4 w-4" />
            {block.blocked ? "Unblock" : "Block"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setReportOpen(true)}>
            <Flag className="mr-2 h-4 w-4" />
            Report
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmBlock} onOpenChange={setConfirmBlock}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block {displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              They won't be able to follow you or interact with your profile. Any existing follow
              relationships between you will be removed. You can unblock them anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={block.pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={block.pending}
              onClick={(e) => {
                e.preventDefault();
                void handleBlockConfirmed();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Block
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReportUserDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        userId={userId}
        displayName={displayName}
      />
    </>
  );
}

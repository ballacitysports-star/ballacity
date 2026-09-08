import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { UserAvatarById } from "@/components/UserAvatar";
import { useBlockedUsersList } from "@/lib/moderation";

export const Route = createFileRoute("/account/blocked")({
  head: () =>
    pageHead({
      path: "/account/blocked",
      title: "Blocked users — ballaCity",
      description:
        "Review the accounts you've blocked on ballaCity and unblock anyone you want to hear from again.",
      noindex: true,
    }),
  ssr: false,
  component: BlockedUsersPage,
});

function BlockedUsersPage() {
  const { users, loading, unblock, unblocking } = useBlockedUsersList();

  async function handleUnblock(id: string, name: string) {
    try {
      await unblock(id);
      toast.success(`${name} unblocked`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't unblock");
    }
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <BackHeader title="Blocked users" fallbackTo="/settings" />

      <main className="mx-auto max-w-xl space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          Blocked accounts can't message you, send you invitations or session requests, or
          follow you. You won't see their invites either.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : users.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center">
            <ShieldOff className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">You haven't blocked anyone</p>
            <p className="mt-1 text-xs text-muted-foreground">
              You can block someone from their profile.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-3 py-3">
                <UserAvatarById
                  userId={u.id}
                  avatarUrl={u.avatarUrl}
                  initials={u.initials}
                  name={u.displayName}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{u.displayName}</p>
                  {u.username ? (
                    <p className="truncate text-xs text-muted-foreground">@{u.username}</p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unblocking}
                  onClick={() => void handleUnblock(u.id, u.displayName)}
                >
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { ArrowLeft, Bell, MessageCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { TeamInvitesInbox } from "@/components/team/TeamInvitesInbox";

export const Route = createFileRoute("/_tabs/notifications")({
  head: () =>
    pageHead({
      path: "/notifications",
      title: "Notifications — ballaCity",
      description: "Join requests, approvals, messages, and game updates in one place.",
      noindex: true,
    }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { user, loading } = useAuth();

  return (
    <div className="page-shell-content pt-6 pb-32">
      <div className="mb-5 flex items-center gap-3">
        <Link
          to="/feed"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="flex-1 page-title">Notifications</h1>
        {/* The inbox has no bottom-nav tab of its own, so Activity is the one
            reliable entry point into it. */}
        <Link
          to="/messages"
          aria-label="Messages"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm font-semibold"
        >
          <MessageCircle className="h-5 w-5" />
          Inbox
        </Link>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : !user ? (
        <div className="pt-6 text-center">
          <Bell className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <h2 className="font-display text-xl font-bold mb-2">Sign in to see your alerts</h2>
          <Link
            to="/auth"
            className="inline-flex rounded-full bg-lime-gradient px-5 py-2.5 text-sm font-bold text-primary-foreground"
          >
            Sign in
          </Link>
        </div>
      ) : (
        <>
          {/* Invitations need an answer, so they sit above the passive feed. */}
          <TeamInvitesInbox className="mb-5" />
          <NotificationsPanel />
        </>
      )}
    </div>
  );
}

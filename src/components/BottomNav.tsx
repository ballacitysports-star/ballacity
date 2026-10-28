import { Link, useLocation } from "@tanstack/react-router";
import { isChatThreadPath } from "@/lib/chat-layout";
import { Clapperboard, Compass, Home, MessageCircle, UserRound } from "lucide-react";
import { MyAvatar } from "@/components/UserAvatar";
import { tabsForMode } from "@/lib/navigation-gestures";
import { useParentMode } from "@/hooks/use-parent-mode";
import { useAuth } from "@/hooks/use-auth";
import { useInboxBadgeCount } from "@/lib/use-inbox-badge";
import { useFamilyPending } from "@/lib/use-family-pending";

type NavItem = {
  to: string;
  label: string;
  icon?: typeof Home;
  /** Draw the icon as an outline even when active (filling it would hide its detail). */
  outline?: boolean;
  match?: (pathname: string) => boolean;
  render?: (active: boolean) => React.ReactNode;
};

/**
 * Five-tab bottom bar: Home, Discover (players, teams, trainers, gyms), Reels, Inbox, Me.
 *
 * The order and the active-route rules come from TABS, which the swipe
 * gesture also steps through — so paging sideways always lands on the tab
 * sitting next to the current one in this bar.
 */
const presentation: Record<string, Pick<NavItem, "icon" | "render" | "outline">> = {
  "/feed": { icon: Home },
  "/players": { icon: Compass, outline: true },
  "/highlights": { icon: Clapperboard },
  "/messages": { icon: MessageCircle },
  "/profile": {
    render: (active) => <MyAvatar ringWhenActive active={active} />,
  },
};

/** The profile tab for a signed-out visitor, who has no avatar to load. */
const signedOutProfile: Pick<NavItem, "icon"> = { icon: UserRound };

export function BottomNav() {
  const { pathname } = useLocation();
  const { isParentMode } = useParentMode();
  const { user } = useAuth();
  // Unread messages, real message requests and alerts: what is waiting in the Inbox.
  const inboxUnread = useInboxBadgeCount();
  const items: NavItem[] = tabsForMode(isParentMode).map((tab) => ({
    to: tab.to,
    label: tab.label,
    match: tab.match,
    ...(tab.to === "/profile" && !user ? signedOutProfile : presentation[tab.to]),
  }));

  const PUBLIC_PATHS = ["/auth", "/reset-password"];
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) return null;
  // Inside a conversation the message box takes the bottom of the screen, as in
  // any messaging app; the back arrow returns to the inbox and the tabs.
  if (isChatThreadPath(pathname)) return null;

  const renderTab = (it: NavItem) => {
    const active = it.match ? it.match(pathname) : pathname === it.to;
    const Icon = it.icon;
    const iconStroke = active ? 2.4 : 1.8;
    return (
      <Link
        key={it.to}
        to={it.to}
        aria-label={it.label}
        aria-current={active ? "page" : undefined}
        className="relative flex min-w-11 min-h-11 flex-1 items-center justify-center py-2.5 transition-transform active:scale-95"
      >
        {it.render ? (
          it.render(active)
        ) : Icon ? (
          <Icon
            className={`h-6 w-6 ${active ? "text-foreground" : "text-muted-foreground"}`}
            strokeWidth={iconStroke}
            fill={active && !it.outline ? "currentColor" : "none"}
          />
        ) : null}
        {/* A shape cue as well as a colour cue, so the active tab is still
            identifiable without relying on colour alone. */}
        <span
          aria-hidden
          className={`pointer-events-none absolute bottom-0.5 h-1 w-1 rounded-full transition-opacity ${
            active ? "bg-lime opacity-100" : "opacity-0"
          }`}
        />
        {it.to === "/profile" && isParentMode ? <FamilyBadge /> : null}
        {it.to === "/messages" && inboxUnread > 0 ? (
          <span
            aria-hidden
            className="absolute right-[22%] top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-coral px-1 text-[10px] font-bold text-white"
          >
            {inboxUnread > 9 ? "9+" : inboxUnread}
          </span>
        ) : null}
        <span className="sr-only">
          {it.label}
          {it.to === "/messages" && inboxUnread > 0 ? `, ${inboxUnread} unread` : ""}
        </span>
      </Link>
    );
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-xl pb-[max(env(safe-area-inset-bottom),0px)]">
      <div
        className="mx-auto flex max-w-md sm:max-w-xl items-center justify-around"
        role="group"
        aria-label="Primary tabs"
      >
        {items.map(renderTab)}
      </div>
    </nav>
  );
}

export type { NavItem };

/**
 * A count on the Me tab for a parent when something waits on them. Its own
 * component so the children are only loaded for parent accounts.
 */
function FamilyBadge() {
  const { pending } = useFamilyPending();
  if (pending.total === 0) return null;
  return (
    <>
      <span className="sr-only">{`, ${pending.total} waiting on you`}</span>
      <span
        aria-hidden
        className="absolute right-[22%] top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-coral px-1 text-[10px] font-bold text-white"
      >
        {pending.total > 9 ? "9+" : pending.total}
      </span>
    </>
  );
}

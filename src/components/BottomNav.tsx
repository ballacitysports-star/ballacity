import { Link, useLocation } from "@tanstack/react-router";
import { Dribbble, Users, MessageCircle, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { MyAvatar } from "@/components/UserAvatar";

type NavItem = {
  to: string;
  label: string;
  icon?: typeof Dribbble;
  match?: (pathname: string) => boolean;
  render?: (active: boolean) => React.ReactNode;
};

/**
 * 5-tab layout with a raised center Create FAB.
 * Players / Teams / Trainers collapse into a single "Community" tab; the
 * three sub-surfaces are swapped via <CommunityTabs /> at the top of each.
 * Inbox continues to cover messages and alerts.
 */
const leftItems: NavItem[] = [
  {
    to: "/feed",
    icon: Dribbble,
    label: "Play",
    match: (p) => p === "/feed" || p === "/discover" || p === "/pickup" || p === "/reels",
  },
  {
    to: "/players",
    icon: Users,
    label: "Community",
    match: (p) => p.startsWith("/players") || p.startsWith("/teams") || p.startsWith("/trainers") || p.startsWith("/orgs"),
  },
];

const rightItems: NavItem[] = [
  {
    to: "/messages",
    icon: MessageCircle,
    label: "Inbox",
    match: (p) => p.startsWith("/messages") || p.startsWith("/notifications"),
  },
  {
    to: "/profile",
    label: "You",
    match: (p) => p.startsWith("/profile"),
    render: (active) => <MyAvatar ringWhenActive active={active} />,
  },
];

export function BottomNav() {
  const { pathname } = useLocation();

  const PUBLIC_PATHS = ["/auth", "/reset-password"];
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) return null;

  const renderTab = (it: NavItem) => {
    const active = it.match ? it.match(pathname) : pathname === it.to;
    const Icon = it.icon;
    return (
      <Link
        key={it.to}
        to={it.to}
        className="relative flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5 py-2.5 text-[10px] font-medium transition-transform active:scale-95 sm:text-[11px]"
      >
        <span
          className={`relative grid h-9 w-11 place-items-center rounded-2xl transition-colors sm:w-14 ${
            active
              ? "bg-primary-gradient text-primary-foreground shadow-[0_6px_18px_-8px_var(--primary)]"
              : "text-muted-foreground"
          }`}
        >
          {it.render
            ? it.render(active)
            : Icon
              ? <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
              : null}
        </span>
        <span
          className={`max-w-full truncate tracking-wide ${
            active ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {it.label}
        </span>
        {active && (
          <motion.span
            layoutId="nav-dot"
            className="absolute -bottom-0.5 h-[3px] w-6 rounded-full bg-primary-gradient"
          />
        )}
      </Link>
    );
  };

  const createActive = pathname.startsWith("/create");

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
      <div className="mx-auto max-w-md rounded-3xl border border-border bg-surface/85 shadow-2xl backdrop-blur-xl sm:max-w-xl lg:max-w-2xl">
        <div className="flex items-end justify-around" role="group" aria-label="Primary tabs">
          {leftItems.map(renderTab)}

          {/* Center Create FAB — raised above the bar */}
          <div className="relative flex flex-1 flex-col items-center">
            <Link
              to="/create"
              aria-label="Host a game"
              className={`-mt-6 grid h-14 w-14 place-items-center rounded-full bg-lime-gradient text-primary-foreground shadow-[0_10px_30px_-8px_var(--primary)] ring-4 ring-background transition-transform active:scale-95 ${
                createActive ? "scale-105" : ""
              }`}
            >
              <Plus className="h-6 w-6" strokeWidth={2.75} />
            </Link>
            <span className="mt-1 text-[10px] font-semibold tracking-wide text-muted-foreground sm:text-[11px]">
              Create
            </span>
          </div>

          {rightItems.map(renderTab)}
        </div>
      </div>
    </nav>
  );
}

export type { NavItem };

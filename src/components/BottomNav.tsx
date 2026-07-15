import { Link, useLocation } from "@tanstack/react-router";
import { Home, Map, Plus, UserCheck, Dribbble, MessageCircle } from "lucide-react";
import { motion } from "framer-motion";
import { MyAvatar } from "@/components/UserAvatar";

type NavItem = {
  to: string;
  label: string;
  icon?: typeof Home;
  match?: (pathname: string) => boolean;
  render?: (active: boolean) => React.ReactNode;
};

/**
 * Simplified 5-tab layout with an elevated center "Host" FAB.
 * Play merges the former Feed + Discover surfaces (list ⇄ map toggle lives inside).
 * Teams live under Players as a segmented control.
 */
const leftItems: NavItem[] = [
  {
    to: "/feed",
    icon: Dribbble,
    label: "Play",
    // Play tab lights up for the merged surface and for legacy paths.
    match: (p) => p === "/feed" || p === "/discover" || p === "/pickup",
  },
  { to: "/players", icon: UserCheck, label: "Players", match: (p) => p.startsWith("/players") || p.startsWith("/teams") },
];

const rightItems: NavItem[] = [
  { to: "/messages", icon: MessageCircle, label: "Inbox", match: (p) => p.startsWith("/messages") },
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
      <li key={it.to} className="min-w-0">
        <Link
          to={it.to}
          className="relative flex flex-col items-center gap-1 px-1 py-3 text-[10px] sm:text-[11px] font-medium"
        >
          <span className="relative">
            {it.render
              ? it.render(active)
              : Icon
                ? <Icon className={`h-5 w-5 ${active ? "text-lime" : "text-muted-foreground"}`} />
                : null}
          </span>
          <span className={`truncate max-w-full ${active ? "text-foreground" : "text-muted-foreground"}`}>
            {it.label}
          </span>
          {active && (
            <motion.span layoutId="nav-dot" className="absolute -bottom-1 h-1 w-1 rounded-full bg-lime" />
          )}
        </Link>
      </li>
    );
  };

  const hostActive = pathname === "/create" || pathname.startsWith("/create");

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 px-3">
      <div className="mx-auto max-w-md sm:max-w-xl lg:max-w-2xl rounded-3xl border border-border bg-surface/85 backdrop-blur-xl shadow-2xl">
        <ul className="relative grid grid-cols-5 items-end">
          {leftItems.map(renderTab)}

          {/* Center elevated Host FAB — the primary create action */}
          <li className="min-w-0 flex justify-center">
            <Link
              to="/create"
              aria-label="Host a game"
              className="relative -mt-6 grid h-14 w-14 place-items-center rounded-full bg-lime-gradient text-primary-foreground shadow-xl glow-lime ring-4 ring-background transition-transform active:scale-95"
            >
              <Plus className={`h-6 w-6 ${hostActive ? "rotate-45" : ""} transition-transform`} strokeWidth={3} />
            </Link>
          </li>

          {rightItems.map(renderTab)}
        </ul>
      </div>
    </nav>
  );
}

// Legacy re-export retained for any callers still importing Map/Home icons — no-op.
export type { NavItem };

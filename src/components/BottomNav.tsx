import { Link, useLocation } from "@tanstack/react-router";
import { Home, UserCheck, Users, Dribbble, MessageCircle, GraduationCap } from "lucide-react";
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
 * Flat 6-tab layout. Inbox merges direct messages and alerts.
 */
const items: NavItem[] = [
  {
    to: "/feed",
    icon: Dribbble,
    label: "Play",
    match: (p) => p === "/feed" || p === "/discover" || p === "/pickup",
  },
  { to: "/players", icon: UserCheck, label: "Players", match: (p) => p.startsWith("/players") },
  { to: "/teams", icon: Users, label: "Teams", match: (p) => p.startsWith("/teams") },
  { to: "/trainers", icon: GraduationCap, label: "Trainers", match: (p) => p.startsWith("/trainers") },
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
        className="relative flex min-w-0 flex-col items-center gap-1 px-0.5 py-2.5 text-[10px] sm:text-[11px] font-medium transition-transform active:scale-95"
      >
        <span
          className={`relative grid h-9 w-11 sm:w-14 place-items-center rounded-2xl transition-colors ${
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
          className={`truncate max-w-full tracking-wide ${
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

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 px-3">
      <div className="mx-auto max-w-md sm:max-w-xl lg:max-w-2xl rounded-3xl border border-border bg-surface/85 backdrop-blur-xl shadow-2xl">
        <div className="flex items-end justify-around" role="group" aria-label="Primary tabs">
          {items.map(renderTab)}
        </div>
      </div>
    </nav>
  );
}

export type { NavItem };

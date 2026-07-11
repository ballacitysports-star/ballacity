import { Link, useLocation } from "@tanstack/react-router";
import { Home, Map, Plus, Users, UserCheck, Dribbble } from "lucide-react";
import { motion } from "framer-motion";
import { MyAvatar } from "@/components/UserAvatar";

type NavItem = {
  to: string;
  label: string;
  icon?: typeof Home;
  render?: (active: boolean) => React.ReactNode;
};

const items: NavItem[] = [
  { to: "/feed", icon: Dribbble, label: "Pickup" },
  { to: "/players", icon: UserCheck, label: "Players" },
  { to: "/teams", icon: Users, label: "Teams" },
  { to: "/create", icon: Plus, label: "Host" },
  { to: "/discover", icon: Map, label: "Map" },
  {
    to: "/profile",
    label: "My Card",
    render: (active) => <MyAvatar ringWhenActive active={active} />,
  },
];

export function BottomNav() {
  const { pathname } = useLocation();
  
  const PUBLIC_PATHS = ["/auth", "/reset-password"];
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) return null;
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 px-3">
      <div className="mx-auto max-w-md sm:max-w-xl lg:max-w-2xl rounded-3xl border border-border bg-surface/85 backdrop-blur-xl shadow-2xl">
        <ul className="grid grid-cols-6">
          {items.map((it) => {
            const active = pathname === it.to || (it.to !== "/feed" && pathname.startsWith(it.to));
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
                  <span
                    className={`truncate max-w-full ${active ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {it.label}
                  </span>
                  {active && (
                    <motion.span
                      layoutId="nav-dot"
                      className="absolute -bottom-1 h-1 w-1 rounded-full bg-lime"
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

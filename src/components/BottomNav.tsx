import { Link, useLocation } from "@tanstack/react-router";
import { Home, Map, Plus, User, Users, UserCheck } from "lucide-react";
import { motion } from "framer-motion";

const items: { to: string; icon: typeof Home; label: string }[] = [
  { to: "/feed", icon: Home, label: "Feed" },
  { to: "/players", icon: UserCheck, label: "Players" },
  { to: "/teams", icon: Users, label: "Teams" },
  { to: "/create", icon: Plus, label: "Host" },
  { to: "/discover", icon: Map, label: "Map" },
  { to: "/profile", icon: User, label: "Me" },
];

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 px-3">
      <div className="mx-auto max-w-md rounded-3xl border border-border bg-surface/85 backdrop-blur-xl shadow-2xl">
        <ul className="grid grid-cols-6">
          {items.map((it) => {
            const active = pathname === it.to || (it.to !== "/feed" && pathname.startsWith(it.to));
            const Icon = it.icon;
            return (
              <li key={it.to}>
                <Link to={it.to} className="flex flex-col items-center gap-1 py-3 text-[11px] font-medium">
                  <Icon className={`h-5 w-5 ${active ? "text-lime" : "text-muted-foreground"}`} />
                  <span className={active ? "text-foreground" : "text-muted-foreground"}>{it.label}</span>
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

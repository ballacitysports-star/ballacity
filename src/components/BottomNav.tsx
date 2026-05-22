import { Link, useLocation } from "@tanstack/react-router";
import { Home, Map, Plus, User, Users } from "lucide-react";
import { motion } from "framer-motion";

const items: { to: string; icon: typeof Home; label: string; primary?: boolean }[] = [
  { to: "/feed", icon: Home, label: "Feed" },
  { to: "/teams", icon: Users, label: "Teams" },
  { to: "/create", icon: Plus, label: "Host", primary: true },
  { to: "/discover", icon: Map, label: "Map" },
  { to: "/profile", icon: User, label: "Me" },
];

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 px-3">
      <div className="mx-auto max-w-md rounded-3xl border border-border bg-surface/85 backdrop-blur-xl shadow-2xl">
        <ul className="grid grid-cols-5">
          {items.map((it) => {
            const active = pathname === it.to || (it.to !== "/feed" && pathname.startsWith(it.to));
            const Icon = it.icon;
            if (it.primary) {
              return (
                <li key={it.to} className="grid place-items-center -mt-6">
                  <Link to={it.to} aria-label={it.label}>
                    <motion.div
                      whileTap={{ scale: 0.92 }}
                      className="h-14 w-14 rounded-2xl bg-lime-gradient grid place-items-center text-primary-foreground glow-lime"
                    >
                      <Icon className="h-6 w-6" strokeWidth={2.5} />
                    </motion.div>
                  </Link>
                </li>
              );
            }
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

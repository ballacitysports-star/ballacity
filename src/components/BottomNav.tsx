import { Link, useLocation } from "@tanstack/react-router";
import { Home, Map, Plus, IdCard, Users, UserCheck, Dribbble } from "lucide-react";
import { motion } from "framer-motion";


const items: { to: string; icon: typeof Home; label: string; key?: string }[] = [
  { to: "/feed", icon: Dribbble, label: "Pickup" },
  { to: "/players", icon: UserCheck, label: "Players" },
  { to: "/teams", icon: Users, label: "Teams" },
  { to: "/create", icon: Plus, label: "Host" },
  { to: "/discover", icon: Map, label: "Map" },
  { to: "/messages", icon: MessageCircle, label: "Chats", key: "messages" },
  { to: "/profile", icon: IdCard, label: "My Card" },
];

export function BottomNav() {
  const { pathname } = useLocation();
  const unreadMessages = useUnreadMessageCount();
  const PUBLIC_PATHS = ["/auth", "/reset-password"];
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) return null;
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 px-3">
      <div className="mx-auto max-w-md sm:max-w-xl lg:max-w-2xl rounded-3xl border border-border bg-surface/85 backdrop-blur-xl shadow-2xl">
        <ul className="grid grid-cols-7">
          {items.map((it) => {
            const active = pathname === it.to || (it.to !== "/feed" && pathname.startsWith(it.to));
            const Icon = it.icon;
            const badge = it.key === "messages" && unreadMessages > 0 ? unreadMessages : 0;
            return (
              <li key={it.to} className="min-w-0">
                <Link
                  to={it.to}
                  className="relative flex flex-col items-center gap-1 px-1 py-3 text-[10px] sm:text-[11px] font-medium"
                >
                  <span className="relative">
                    <Icon className={`h-5 w-5 ${active ? "text-lime" : "text-muted-foreground"}`} />
                    {badge > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                        {badge > 9 ? "9+" : badge}
                      </span>
                    )}
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

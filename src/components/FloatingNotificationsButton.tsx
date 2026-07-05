import { Link, useLocation } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { motion } from "framer-motion";
import { useUnreadNotificationCount } from "@/lib/notifications";

const HIDDEN_PATHS = ["/auth", "/reset-password", "/notifications"];

export function FloatingNotificationsButton() {
  const { pathname } = useLocation();
  const unread = useUnreadNotificationCount();

  const hidden = HIDDEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (hidden) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="fixed z-50 right-4 top-[max(env(safe-area-inset-top),1rem)]"
    >
      <Link
        to="/notifications"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        className="relative flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface/85 backdrop-blur-xl shadow-lg hover:bg-surface transition-colors"
      >
        <Bell className="h-5 w-5 text-foreground" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Link>
    </motion.div>
  );
}

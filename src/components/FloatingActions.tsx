import { Link, useLocation } from "@tanstack/react-router";
import { Bell, MessageCircle } from "lucide-react";
import { useUnreadNotificationCount, useUnreadMessageCount } from "@/lib/notifications";

const HIDDEN_PATHS = ["/auth", "/reset-password"];

export function FloatingActions() {
  const { pathname } = useLocation();
  const unreadN = useUnreadNotificationCount();
  const unreadM = useUnreadMessageCount();

  if (HIDDEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  return (
    <div
      className="fixed right-3 z-40 flex flex-col gap-2"
      style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
    >
      <FloatBtn to="/notifications" label="Alerts" badge={unreadN} icon={Bell} />
      <FloatBtn to="/messages" label="Messages" badge={unreadM} icon={MessageCircle} />
    </div>
  );
}

function FloatBtn({
  to,
  label,
  badge,
  icon: Icon,
}: {
  to: string;
  label: string;
  badge: number;
  icon: typeof Bell;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      className="relative grid h-11 w-11 place-items-center rounded-full border border-border bg-surface/85 backdrop-blur-xl shadow-lg text-foreground hover:text-lime transition-colors"
    >
      <Icon className="h-5 w-5" />
      {badge > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-lime text-primary-foreground text-[10px] font-bold grid place-items-center">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

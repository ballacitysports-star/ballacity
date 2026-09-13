import { Link, useLocation } from "@tanstack/react-router";
import { Home, Users, Shield, Clapperboard, Heart } from "lucide-react";
import { MyAvatar } from "@/components/UserAvatar";
import { TABS } from "@/lib/navigation-gestures";

type NavItem = {
  to: string;
  label: string;
  icon?: typeof Home;
  match?: (pathname: string) => boolean;
  render?: (active: boolean) => React.ReactNode;
};

/**
 * Instagram-style 6-tab bottom bar: Home, Available Players, Teams, Highlights, Activity, Profile.
 *
 * The order and the active-route rules come from TABS, which the swipe
 * gesture also steps through — so paging sideways always lands on the tab
 * sitting next to the current one in this bar.
 */
const presentation: Record<string, Pick<NavItem, "icon" | "render">> = {
  "/feed": { icon: Home },
  "/players": { icon: Users },
  "/teams": { icon: Shield },
  "/highlights": { icon: Clapperboard },
  "/notifications": { icon: Heart },
  "/profile": {
    render: (active) => <MyAvatar ringWhenActive active={active} />,
  },
};

const items: NavItem[] = TABS.map((tab) => ({
  to: tab.to,
  label: tab.label,
  match: tab.match,
  ...presentation[tab.to],
}));

export function BottomNav() {
  const { pathname } = useLocation();

  const PUBLIC_PATHS = ["/auth", "/reset-password"];
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) return null;

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
        {it.render
          ? it.render(active)
          : Icon ? (
              <Icon
                className={`h-6 w-6 ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
                strokeWidth={iconStroke}
                fill={active ? "currentColor" : "none"}
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
        <span className="sr-only">{it.label}</span>
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

import { Link, useLocation } from "@tanstack/react-router";
import { UserCheck, Users, GraduationCap } from "lucide-react";

/**
 * Shared segmented control that lets people jump between the three
 * "Community" surfaces (Players, Teams, Trainers) without hunting through
 * the bottom nav. Rendered at the top of each of those three routes.
 */
const items = [
  { to: "/players", label: "Players", icon: UserCheck, match: (p: string) => p.startsWith("/players") },
  { to: "/teams", label: "Teams", icon: Users, match: (p: string) => p.startsWith("/teams") },
  { to: "/trainers", label: "Trainers", icon: GraduationCap, match: (p: string) => p.startsWith("/trainers") },
] as const;

export function CommunityTabs() {
  const { pathname } = useLocation();
  return (
    <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-border bg-background/85 px-4 py-2 backdrop-blur-xl sm:mx-0 sm:rounded-2xl sm:border sm:px-2">
      <div
        role="tablist"
        aria-label="Community"
        className="mx-auto flex max-w-md items-center gap-1 rounded-2xl bg-surface p-1"
      >
        {items.map((it) => {
          const active = it.match(pathname);
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              role="tab"
              aria-selected={active}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                active
                  ? "bg-primary-gradient text-primary-foreground shadow-[0_6px_18px_-8px_var(--primary)]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={active ? 2.5 : 2} />
              {it.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

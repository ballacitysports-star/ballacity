import { Link, useLocation } from "@tanstack/react-router";
import { showsDiscoverTabs } from "@/lib/discover-paths";

const SECTIONS = [
  { to: "/players", label: "Players" },
  { to: "/teams", label: "Teams" },
  { to: "/trainers", label: "Trainers" },
  { to: "/orgs", label: "Gyms" },
] as const;

/**
 * Players, Teams, Trainers and Gyms are one place in the bottom bar ("Discover");
 * this strip switches between them.
 */
export function DiscoverTabs() {
  const { pathname } = useLocation();
  if (!showsDiscoverTabs(pathname)) return null;
  const current = pathname.replace(/\/+$/, "");
  return (
    <nav aria-label="Discover" className="page-shell pt-3">
      <ul className="flex gap-2 overflow-x-auto">
        {SECTIONS.map((s) => {
          const active = current === s.to;
          return (
            <li key={s.to}>
              <Link
                to={s.to}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
                  active
                    ? "border-lime bg-lime/15 text-lime"
                    : "border-border text-muted-foreground hover:border-lime/40"
                }`}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

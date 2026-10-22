import { Link, useLocation } from "@tanstack/react-router";
import { showsDiscoverTabs } from "@/lib/discover-paths";

const SECTIONS = [
  { to: "/players", label: "Players" },
  { to: "/teams", label: "Teams" },
  { to: "/trainers", label: "Trainers" },
  { to: "/orgs", label: "Gyms" },
] as const;

/** The search text in the current page's URL, which the strip carries to the next section. */
export function carriedQuery(search: unknown): string {
  const q = (search as { q?: unknown } | null | undefined)?.q;
  return typeof q === "string" ? q.trim() : "";
}

/**
 * Players, Teams, Trainers and Gyms are one place in the bottom bar ("Discover");
 * this strip switches between them. `bare` drops its own page padding for a page that already has some. What you typed in a search box follows you,
 * so one search can be tried against each.
 */
export function DiscoverTabs({ bare = false }: { bare?: boolean }) {
  const { pathname, search } = useLocation();
  if (!showsDiscoverTabs(pathname)) return null;
  const current = pathname.replace(/\/+$/, "");
  const q = carriedQuery(search);
  return (
    <nav aria-label="Discover" className={bare ? "" : "page-shell pt-3"}>
      <ul className="flex gap-2 overflow-x-auto">
        {SECTIONS.map((s) => {
          const active = current === s.to;
          return (
            <li key={s.to}>
              <Link
                to={s.to}
                // Each section validates its own search; only `q` is shared.
                search={(q ? { q } : {}) as never}
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

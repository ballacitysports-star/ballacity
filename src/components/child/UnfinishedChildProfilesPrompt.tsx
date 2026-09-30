import { Link } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { useUnfinishedChildProfiles } from "@/lib/use-managed-children";

/**
 * Children a parent started on the old Add Player screen.
 *
 * That screen saved a record nothing in the app ever read, so the parent was
 * shown "Player created!" and then never saw the child again. Each leftover is
 * offered here, prefilled, so the parent can finish it as a real managed
 * profile; the old record is removed once they do.
 */
export function UnfinishedChildProfilesPrompt() {
  const { data } = useUnfinishedChildProfiles();
  const rows = data ?? [];
  if (rows.length === 0) return null;

  return (
    <section className="mt-5 rounded-2xl border border-amber-400/40 bg-amber-50/10 p-4">
      <div className="flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-amber-500" aria-hidden />
        <h2 className="font-display text-sm font-bold">Finish setting up</h2>
      </div>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">
        You started adding {rows.length === 1 ? "this child" : "these children"} before child
        profiles were fully ready. Finish setup to manage their profile here.
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2"
          >
            <span className="truncate text-sm font-semibold">{r.firstName || "Your child"}</span>
            <Link
              to="/players/add"
              search={{ from: "parent", prefill: r.id }}
              className="shrink-0 text-xs font-semibold text-primary underline underline-offset-2"
            >
              Finish setup
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

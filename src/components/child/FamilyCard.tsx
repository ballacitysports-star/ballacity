import { Link } from "@tanstack/react-router";
import { ChevronRight, Users } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { describePending } from "@/lib/family-pending";
import { useFamilyRoster } from "@/lib/family-roster";
import { useFamilyPending } from "@/lib/use-family-pending";

/**
 * The top of Me for a parent account: each child with where they stand, and
 * anything waiting on the parent, with one way into the Parent Center. It
 * replaces a row of links so a parent sees "who needs me" before anything else.
 */
export function FamilyCard() {
  const roster = useFamilyRoster();
  const { pending } = useFamilyPending();
  const children = roster.all;
  const waiting = describePending(pending);

  return (
    <section aria-label="Family" className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-2xl border border-lime/30 bg-lime/10 text-lime">
            <Users className="h-4 w-4" aria-hidden />
          </span>
          <h2 className="section-eyebrow text-foreground">Family</h2>
        </div>
        {pending.total > 0 ? (
          <span className="rounded-full bg-coral px-2.5 py-1 text-[11px] font-bold text-white">
            {pending.total} waiting on you
          </span>
        ) : null}
      </div>

      {waiting ? <p className="mt-2 text-sm text-foreground">{waiting}</p> : null}

      {roster.isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : children.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No children linked yet. Add one from the Parent Center.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {children.slice(0, 4).map((e) => (
            <li key={e.child.childUserId}>
              <Link
                to="/parent"
                className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 hover:border-lime/40"
              >
                <UserAvatar avatarUrl={e.child.avatarUrl} name={e.child.displayName} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {e.child.displayName}
                  </span>
                  <span
                    className={`block truncate text-xs ${e.needsGuardian ? "font-semibold text-coral" : "text-muted-foreground"}`}
                  >
                    {e.statusLabel}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to="/parent"
          className="inline-flex min-h-11 items-center rounded-full bg-lime-gradient px-4 text-sm font-bold text-primary-foreground"
        >
          Open Parent Center
        </Link>
        <Link
          to="/guardian"
          className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold hover:border-lime/40"
        >
          Kids' schedule
        </Link>
      </div>
    </section>
  );
}

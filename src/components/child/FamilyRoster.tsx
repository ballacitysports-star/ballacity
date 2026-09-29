import { Link } from "@tanstack/react-router";
import { AlertTriangle, CalendarDays, ExternalLink, Lock, Users } from "lucide-react";
import { COHORT_META } from "@/lib/child-policy";
import { formatRelativeDay } from "@/lib/datetime";
import type { RosterEntry } from "@/lib/family-roster";

/**
 * The guardian's at-a-glance roster.
 *
 * Replaces FamilyChildSwitcher: it keeps that component's tab semantics (so
 * the detail panel below stays keyboard-reachable and correctly labelled) and
 * adds what a guardian actually needs on arrival — who is blocked, who is
 * playing, and each child's profile — instead of one child at a time.
 */

const TONE: Record<RosterEntry["status"], string> = {
  awaiting_approval: "text-amber-500",
  consent_withdrawn: "text-destructive",
  no_consent: "text-muted-foreground",
  not_required: "text-primary",
  approved: "text-primary",
};

function Avatar({ url, name }: { url: string | null; name: string }) {
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2 text-xs font-bold">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

function ChildCard({
  entry,
  selected,
  onSelect,
  onArrow,
}: {
  entry: RosterEntry;
  selected: boolean;
  onSelect: () => void;
  onArrow: (dir: 1 | -1) => void;
}) {
  const { child } = entry;
  return (
    <li className="min-w-0">
      <div
        className={`h-full rounded-2xl border p-3 transition-colors ${
          selected ? "border-primary bg-primary/10" : "border-border bg-surface"
        }`}
      >
        <button
          type="button"
          role="tab"
          id={`child-tab-${child.childUserId}`}
          aria-selected={selected}
          aria-controls={`child-panel-${child.childUserId}`}
          tabIndex={selected ? 0 : -1}
          onClick={onSelect}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            onArrow(e.key === "ArrowRight" ? 1 : -1);
          }}
          className="flex w-full items-center gap-3 text-left"
        >
          <Avatar url={child.avatarUrl} name={child.displayName} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{child.displayName}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {COHORT_META[child.cohort].label}
              {entry.managed ? " · Managed by you" : child.username ? ` · @${child.username}` : ""}
            </span>
            <span className={`block truncate text-xs font-semibold ${TONE[entry.status]}`}>
              {entry.statusLabel}
            </span>
          </span>
        </button>

        {entry.ageReviewRequired ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-400/40 bg-amber-50/10 px-2 py-1.5 text-[11px] text-amber-500">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            Their date of birth is under review.
          </p>
        ) : null}

        {/* The profile, inline. A guardian can always read this much about
            their own child, whatever the child's public visibility is. */}
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden />
            <dt className="sr-only">Teams</dt>
            <dd>
              <span className="font-semibold text-foreground">{child.teamCount}</span>{" "}
              {child.teamCount === 1 ? "team" : "teams"}
            </dd>
          </div>
          <div className="flex items-center gap-1">
            <CalendarDays className="h-3 w-3" aria-hidden />
            <dt className="sr-only">Upcoming games</dt>
            <dd>
              <span className="font-semibold text-foreground">{child.upcomingGames}</span> upcoming
            </dd>
          </div>
        </dl>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {child.nextGame ? (
            <>
              Next: <span className="font-semibold">{child.nextGame.title ?? "Game"}</span>{" "}
              {formatRelativeDay(child.nextGame.at)}
            </>
          ) : (
            "No upcoming games."
          )}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <button
            type="button"
            onClick={onSelect}
            className="font-semibold text-primary underline underline-offset-2"
          >
            {selected ? "Showing settings below" : "Manage settings"}
          </button>
          {entry.publicProfileReachable ? (
            <Link
              to="/players/$userId"
              params={{ userId: child.childUserId }}
              className="inline-flex items-center gap-1 font-semibold text-primary underline underline-offset-2"
            >
              View profile <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Lock className="h-3 w-3" aria-hidden /> Profile is private
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

export function FamilyRoster({
  needsAction,
  approved,
  selected,
  onSelect,
}: {
  needsAction: RosterEntry[];
  approved: RosterEntry[];
  selected: string | null;
  onSelect: (childUserId: string) => void;
}) {
  const ordered = [...needsAction, ...approved];
  if (ordered.length === 0) return null;

  const move = (from: string, dir: 1 | -1) => {
    const i = ordered.findIndex((e) => e.child.childUserId === from);
    const next = ordered[(i + dir + ordered.length) % ordered.length];
    if (!next) return;
    onSelect(next.child.childUserId);
    document.getElementById(`child-tab-${next.child.childUserId}`)?.focus();
  };

  const section = (title: string, hint: string, entries: RosterEntry[]) =>
    entries.length === 0 ? null : (
      <div className="mt-4">
        <h2 className="section-eyebrow text-muted-foreground">
          {title} ({entries.length})
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {entries.map((entry) => (
            <ChildCard
              key={entry.child.childUserId}
              entry={entry}
              selected={entry.child.childUserId === selected}
              onSelect={() => onSelect(entry.child.childUserId)}
              onArrow={(dir) => move(entry.child.childUserId, dir)}
            />
          ))}
        </ul>
      </div>
    );

  return (
    <div role="tablist" aria-label="Your linked children">
      {section("Needs your approval", "These accounts stay limited until you act.", needsAction)}
      {section("Approved players", "Active accounts you manage.", approved)}
    </div>
  );
}

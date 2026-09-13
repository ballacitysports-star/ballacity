import { useState } from "react";
import { Trophy } from "lucide-react";
import { badgesInProgress, getBadge, type BadgeStats } from "@/lib/badges";

function BadgeChip({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const def = getBadge(id);
  const label = def ? `${def.emoji} ${def.label}` : id;
  const tierRing =
    def?.tier === "gold"
      ? "border-amber-400/40 bg-amber-400/10"
      : def?.tier === "silver"
        ? "border-sky-400/30 bg-sky-400/10"
        : "border-border bg-surface";

  if (!def) {
    return (
      <span className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold">
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      title={def.description}
      className={`rounded-full border px-3 py-1.5 text-left text-xs font-semibold transition-colors ${tierRing}`}
    >
      {label}
      {open && <span className="ml-2 font-normal text-muted-foreground">{def.description}</span>}
    </button>
  );
}

/**
 * Renders earned badges (derived from attendance reliability + sportsmanship)
 * and, optionally, the next badges in progress.
 */
export function BadgeList({
  badgeIds,
  stats,
  showProgress = false,
  title = "Badges",
  className = "",
}: {
  badgeIds: string[];
  stats?: BadgeStats;
  showProgress?: boolean;
  title?: string;
  className?: string;
}) {
  const upcoming = showProgress && stats ? badgesInProgress(stats, 3) : [];
  if (badgeIds.length === 0 && upcoming.length === 0) return null;

  return (
    <div className={className}>
      <h2 className="section-eyebrow text-muted-foreground mb-2 flex items-center gap-1.5">
        <Trophy className="h-4 w-4" /> {title}
      </h2>
      {badgeIds.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {badgeIds.map((b) => (
            <BadgeChip key={b} id={b} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Show up on time and earn great reviews to unlock badges.
        </p>
      )}

      {upcoming.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 section-eyebrow text-muted-foreground">In progress</h3>
          <div className="space-y-2">
            {upcoming.map(({ badge, progress, ratio }) => (
              <div key={badge.id} className="rounded-2xl border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">
                    {badge.emoji} {badge.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {progress.current}/{progress.target} {progress.unit}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-lime"
                    style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">{badge.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

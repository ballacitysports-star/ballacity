/**
 * "Since your last clip": did what the analysis flagged last time get better?
 * Compares this reel with the most recent earlier reel in the same sport, using only
 * analytics already stored. A fix that simply is not mentioned again is shown as
 * "not seen in this clip", never as progress. Drills come from the coaching the AI
 * already wrote for this reel.
 */

import { ANALYTICS_RATING_LABELS } from "@/lib/reel-analytics";
import type { FocusStatus, FollowUp } from "@/lib/reel-trends";

const LABEL: Record<FocusStatus, { text: string; tone: string }> = {
  improved: { text: "Improved", tone: "border-lime/50 bg-lime/10 text-lime" },
  holding: { text: "Holding", tone: "border-border bg-background text-foreground" },
  still: { text: "Still working on", tone: "border-coral/40 bg-coral/10 text-coral" },
  new: { text: "New this clip", tone: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
  not_seen: { text: "Not seen in this clip", tone: "border-border bg-background text-muted-foreground" },
};

export function ReelFollowUp({ followUp, drills }: { followUp: FollowUp; drills: string[] }) {
  const moved = followUp.ratingChanges.filter((r) => r.change !== 0);
  const overall = followUp.ratingChanges.find((r) => r.key === "overall");
  const next = followUp.items.some((i) => i.status === "still" || i.status === "new");
  return (
    <div className="mt-3 rounded-xl border border-border bg-background/60 p-3" aria-label="Since your last clip">
      <p className="micro-label text-lime">Since your last clip</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Compared with &ldquo;{followUp.priorTitle}&rdquo;
        {overall && overall.change !== 0
          ? ` · overall ${overall.change > 0 ? "+" : ""}${overall.change}`
          : ""}
        {moved.length > 1
          ? ` · ${moved
              .filter((r) => r.key !== "overall")
              .map((r) => `${ANALYTICS_RATING_LABELS[r.key].split(" ")[0]} ${r.change > 0 ? "+" : ""}${r.change}`)
              .join(", ")}`
          : ""}
      </p>

      {followUp.items.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {followUp.items.map((i) => (
            <li key={`${i.area}-${i.status}`} className="flex items-start gap-2 text-xs">
              <span
                className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${LABEL[i.status].tone}`}
              >
                {LABEL[i.status].text}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{i.area}</span>
                <span className="text-muted-foreground"> · {i.cue}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {next && drills.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Try before your next clip</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {drills.slice(0, 2).map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {next && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Film the same skill again and upload it to see whether it moves.
        </p>
      )}
    </div>
  );
}

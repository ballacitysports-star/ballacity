import { CheckCircle2, Circle } from "lucide-react";
import type { StrengthItem } from "@/lib/org-listing";

/** Google-style "profile strength" meter with a jump-to-section checklist. */
export function ProfileStrengthMeter({
  percent,
  items,
}: {
  percent: number;
  items: StrengthItem[];
}) {
  const missing = items.filter((i) => !i.done);
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
          Profile strength
        </h2>
        <span className="text-sm font-bold text-lime">{percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-lime-gradient transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      {missing.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-lime">
          <CheckCircle2 className="h-3.5 w-3.5" /> Your listing is complete.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {missing.slice(0, 5).map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById(i.section)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:border-lime/60"
              >
                <Circle className="h-3 w-3" /> {i.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

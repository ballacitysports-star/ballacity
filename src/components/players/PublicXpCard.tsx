import { Sparkles } from "lucide-react";
import type { PublicXp } from "@/lib/athlete-xp";

/** A minor's level, XP bar and milestone badges. Shown only when their guardian opted in. */
export function PublicXpCard({ xp: p }: { xp: PublicXp }) {
  const pct = Math.round((p.levelXp / p.nextLevelXp) * 100);
  return (
    <section className="mt-4 px-4" aria-label="Level and XP">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-lime-gradient text-primary-foreground glow-lime">
            <div className="text-center leading-none">
              <div className="text-[9px] font-bold uppercase">Lvl</div>
              <div className="font-display text-xl font-black">{p.level}</div>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold">
                <Sparkles className="h-3.5 w-3.5 text-lime" /> {p.xp.toLocaleString()} XP
              </span>
              <span className="tabular-nums text-muted-foreground">
                {p.nextLevelXp - p.levelXp} XP to Lvl {p.level + 1}
              </span>
            </div>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-background"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progress to next level"
            >
              <div className="h-full rounded-full bg-lime" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
        {p.badges.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Unlocked badges">
            {p.badges.map((b) => (
              <li
                key={b.id}
                title={b.hint}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2.5 py-1 text-xs font-semibold"
              >
                <span aria-hidden>{b.emoji}</span> {b.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

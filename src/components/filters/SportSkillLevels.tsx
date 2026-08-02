import type { Sport } from "@/lib/sample-data";
import { scaleForSport } from "@/lib/sport-levels";
import {
  selectedTiersForSport,
  toggleSportSkillTier,
  type SportSkillMap,
} from "@/lib/sport-filter";

/**
 * Per-sport skill level picker for filters. Reads exactly like the Sports
 * section of Edit profile: one block per selected sport, each using that
 * sport's real scale (grouped formats for Football, NTRP for Tennis…).
 */
export function SportSkillLevels({
  sports,
  value,
  onChange,
}: {
  sports: string[];
  value: SportSkillMap;
  onChange: (next: SportSkillMap) => void;
}) {
  if (sports.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Pick one or more sports to filter by their own levels.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {sports.map((sport) => {
        const scale = scaleForSport(sport as Sport);
        const selected = selectedTiersForSport(value, sport);
        const chip = (tier: string, groupLabel?: string) => {
          const active = selected.includes(tier);
          const label =
            groupLabel && tier.startsWith(`${groupLabel} `)
              ? tier.slice(groupLabel.length + 1)
              : tier;
          return (
            <button
              key={tier}
              type="button"
              aria-pressed={active}
              aria-label={`${sport} ${tier}`}
              onClick={() => onChange(toggleSportSkillTier(value, sport, tier))}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                active
                  ? "border-lime bg-lime/15 text-lime"
                  : "border-border bg-background text-muted-foreground hover:border-lime/40 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        };
        return (
          <div key={sport} className="rounded-2xl border border-border bg-surface p-3">
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="text-xs font-semibold">{sport}</span>
              <span className="text-[10px] text-muted-foreground/70">{scale.system}</span>
              {scale.multi && (
                <span className="text-[10px] text-muted-foreground/70">· pick one or more</span>
              )}
            </div>
            {scale.groups ? (
              <div className="space-y-2">
                {scale.groups.map((g) => (
                  <div key={g.label}>
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                      {g.label}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.tiers.map((t) => chip(t, g.label))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">{scale.tiers.map((t) => chip(t))}</div>
            )}
            {scale.hint && (
              <p className="mt-1.5 text-[10px] text-muted-foreground">{scale.hint}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

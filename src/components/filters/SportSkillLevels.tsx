import type { Sport } from "@/lib/sample-data";
import { scaleForSport } from "@/lib/sport-levels";
import {
  selectedTiersForSport,
  toggleSportSkillTier,
  type SportSkillMap,
} from "@/lib/sport-filter";
import { TierChips } from "@/components/sports/TierChips";

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
        return (
          <div key={sport} className="rounded-2xl border border-border bg-surface p-3">
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="text-xs font-semibold">{sport}</span>
              <span className="text-[10px] text-muted-foreground/70">{scale.system}</span>
              {scale.multi && (
                <span className="text-[10px] text-muted-foreground/70">· pick one or more</span>
              )}
            </div>
            <TierChips
              scale={scale}
              selected={selected}
              ariaPrefix={sport}
              onToggle={(tier) => onChange(toggleSportSkillTier(value, sport, tier))}
            />
          </div>
        );
      })}
    </div>
  );
}

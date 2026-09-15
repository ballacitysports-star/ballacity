import { X } from "lucide-react";
import { SPORTS, POSITIONS_BY_SPORT, type Sport } from "@/lib/sample-data";
import { levelTiers, scaleForSport, toggleSportTier, type SportLevel } from "@/lib/sport-levels";
import { TierChips } from "@/components/sports/TierChips";

export type SportEntry = { name: Sport; positions?: string[]; level?: SportLevel | null };

/**
 * The canonical "Sports" editor. Shared by Edit profile and onboarding.
 */
export function ProfileSportsFields({
  sports,
  onChange,
}: {
  sports: SportEntry[];
  onChange: (next: SportEntry[]) => void;
}) {
  const addSport = (s: Sport) => {
    if (sports.some((x) => x.name === s)) return;
    onChange([...sports, { name: s }]);
  };
  const removeSport = (s: Sport) => onChange(sports.filter((x) => x.name !== s));
  const setLevel = (s: Sport, tier: string) =>
    onChange(
      sports.map((x) => {
        if (x.name !== s) return x;
        return { ...x, level: toggleSportTier(s, x.level, tier) };
      }),
    );
  const togglePosition = (s: Sport, pos: string) =>
    onChange(
      sports.map((x) => {
        if (x.name !== s) return x;
        const cur = x.positions ?? [];
        return {
          ...x,
          positions: cur.includes(pos) ? cur.filter((p) => p !== pos) : [...cur, pos],
        };
      }),
    );

  return (
    <>
      <div className="space-y-2">
        {sports.map((s) => (
          <div key={s.name} className="rounded-2xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">{s.name}</span>
              <button
                type="button"
                onClick={() => removeSport(s.name)}
                aria-label={`Remove ${s.name}`}
                className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {(() => {
              const scale = scaleForSport(s.name);
              return (
                <div className="mt-3">
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="micro-label text-muted-foreground">
                      Level
                    </span>
                    <span className="text-[10px] text-muted-foreground/70">{scale.system}</span>
                    {scale.multi && (
                      <span className="text-[10px] text-muted-foreground/70">
                        · pick one or more
                      </span>
                    )}
                  </div>
                  <TierChips
                    scale={scale}
                    selected={levelTiers(s.level)}
                    ariaPrefix={s.name}
                    onToggle={(tier) => setLevel(s.name, tier)}
                  />
                </div>
              );
            })()}

            {POSITIONS_BY_SPORT[s.name]?.length > 0 && (
              <div className="mt-3">
                <div className="micro-label text-muted-foreground mb-1.5">
                  Positions
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {POSITIONS_BY_SPORT[s.name].map((pos) => {
                    const active = (s.positions ?? []).includes(pos);
                    return (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => togglePosition(s.name, pos)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                          active
                            ? "border-lime bg-lime/15 text-lime"
                            : "border-border bg-background text-muted-foreground hover:border-lime/40 hover:text-foreground"
                        }`}
                      >
                        {pos}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3">
        <div className="text-xs text-muted-foreground mb-1.5">Add sport</div>
        <div className="flex flex-wrap gap-2">
          {SPORTS.filter((s) => !sports.some((x) => x.name === s.name)).map((s) => (
            <button
              key={s.name}
              type="button"
              onClick={() => addSport(s.name)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:border-lime/40"
            >
              <span>{s.emoji}</span>
              {s.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

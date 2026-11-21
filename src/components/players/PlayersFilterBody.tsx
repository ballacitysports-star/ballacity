import { useMemo, type ReactNode } from "react";
import { ViewDensityToggle, type ViewMode, type Density } from "@/components/ViewDensityToggle";
import { FilterSection } from "@/components/FilterSheet";
import { DistanceSlider } from "@/components/DistanceSlider";
import { SportSkillLevels } from "@/components/filters/SportSkillLevels";
import { SortSection } from "@/components/filters/SortSection";
import { SPORTS } from "@/lib/sample-data";
import { useDistanceUnit } from "@/lib/user-prefs-store";
import { orderSportsForViewer } from "@/lib/sport-hubs";
import type { SportSkillMap } from "@/lib/sport-filter";

export type PlayersSortBy = "recent" | "soonest" | "nearest" | "name";

export const PLAYER_SORTS = [
  { value: "recent" as const, label: "Recently posted" },
  { value: "soonest" as const, label: "Soonest available" },
  { value: "nearest" as const, label: "Nearest" },
  { value: "name" as const, label: "Name A–Z" },
];

/**
 * Find Players' filter sheet. WP 4.1: the results layout (list, grid, map) is chosen here, under "View", because the
 * page no longer has its own toggle; the sport chips start with Basketball, then the member's own sports.
 */
export function PlayersFilterBody({
  viewMode,
  onViewChange,
  density,
  onDensityChange,
  sportPriority,
  sports,
  onToggleSport,
  onClearSports,
  skills,
  setSkills,
  maxDistance,
  setMaxDistance,
  ageMin,
  setAgeMin,
  ageMax,
  setAgeMax,
  includeUnknownAge,
  setIncludeUnknownAge,
  sortBy,
  setSortBy,
}: {
  viewMode: ViewMode;
  onViewChange: (v: ViewMode) => void;
  density: Density;
  onDensityChange: (d: Density) => void;
  sportPriority: string[];
  sports: string[];
  onToggleSport: (v: string | null) => void;
  onClearSports: () => void;
  skills: SportSkillMap;
  setSkills: (v: SportSkillMap) => void;
  maxDistance: number;
  setMaxDistance: (v: number) => void;
  ageMin: number | "";
  setAgeMin: (v: number | "") => void;
  ageMax: number | "";
  setAgeMax: (v: number | "") => void;
  includeUnknownAge: boolean;
  setIncludeUnknownAge: (v: boolean) => void;
  sortBy: PlayersSortBy;
  setSortBy: (v: PlayersSortBy) => void;
}) {
  const unit = useDistanceUnit();
  const orderedSports = useMemo(() => orderSportsForViewer(SPORTS, sportPriority), [sportPriority]);
  return (
    <>
      <FilterSection label="View">
        <ViewDensityToggle
          variant="sheet"
          view={viewMode}
          onViewChange={onViewChange}
          density={density}
          onDensityChange={onDensityChange}
        />
      </FilterSection>

      <SortSection value={sortBy} onChange={setSortBy} options={PLAYER_SORTS} />

      <FilterSection label="Sports (Players)">
        <div className="flex flex-wrap gap-2">
          <Chip active={sports.length === 0} onClick={onClearSports}>
            All sports
          </Chip>
          {orderedSports.map((s) => (
            <Chip
              key={s.name}
              active={sports.includes(s.name)}
              onClick={() => onToggleSport(s.name)}
            >
              <span className="mr-1">{s.emoji}</span>
              {s.name}
            </Chip>
          ))}
        </div>
      </FilterSection>

      <FilterSection label="Skill level">
        <SportSkillLevels sports={sports} value={skills} onChange={setSkills} />
      </FilterSection>

      <FilterSection label="Max travel distance">
        <DistanceSlider
          valueMi={maxDistance > 0 ? maxDistance : null}
          onChange={(mi) => setMaxDistance(mi ?? 0)}
          unit={unit}
          label="Max travel distance"
        />
      </FilterSection>

      <FilterSection label="Age range">
        <div className="flex items-center gap-2 mb-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={120}
            value={ageMin}
            onChange={(e) =>
              setAgeMin(
                e.target.value === "" ? "" : Math.max(1, Math.min(120, Number(e.target.value))),
              )
            }
            placeholder="Min"
            className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm outline-none"
            aria-label="Minimum age"
          />
          <span className="text-muted-foreground text-sm">–</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={120}
            value={ageMax}
            onChange={(e) =>
              setAgeMax(
                e.target.value === "" ? "" : Math.max(1, Math.min(120, Number(e.target.value))),
              )
            }
            placeholder="Max"
            className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm outline-none"
            aria-label="Maximum age"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip
            active={ageMin === "" && ageMax === ""}
            onClick={() => {
              setAgeMin("");
              setAgeMax("");
            }}
          >
            Any age
          </Chip>
          <Chip
            active={ageMin === 13 && ageMax === 17}
            onClick={() => {
              setAgeMin(13);
              setAgeMax(17);
            }}
          >
            13–17
          </Chip>
          <Chip
            active={ageMin === 18 && ageMax === 24}
            onClick={() => {
              setAgeMin(18);
              setAgeMax(24);
            }}
          >
            18–24
          </Chip>
          <Chip
            active={ageMin === 25 && ageMax === 34}
            onClick={() => {
              setAgeMin(25);
              setAgeMax(34);
            }}
          >
            25–34
          </Chip>
          <Chip
            active={ageMin === 35 && ageMax === 49}
            onClick={() => {
              setAgeMin(35);
              setAgeMax(49);
            }}
          >
            35–49
          </Chip>
          <Chip
            active={ageMin === 50 && ageMax === ""}
            onClick={() => {
              setAgeMin(50);
              setAgeMax("");
            }}
          >
            50+
          </Chip>
        </div>
        <label className="flex items-center gap-2 mt-3 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            className="h-4 w-4 accent-lime"
            checked={includeUnknownAge}
            disabled={ageMin === "" && ageMax === ""}
            onChange={(e) => setIncludeUnknownAge(e.target.checked)}
          />
          <span>Include players who haven't shared a birthday</span>
        </label>
      </FilterSection>
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${active ? "border-lime bg-lime/15 text-foreground" : "border-border bg-surface text-muted-foreground"}`}
    >
      {children}
    </button>
  );
}

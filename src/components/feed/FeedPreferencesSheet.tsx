import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bookmark, BookmarkPlus, Check, Trash2, X } from "lucide-react";
import { FilterSection } from "@/components/FilterSheet";
import { SortSection } from "@/components/filters/SortSection";
import { SPORTS, type Sport } from "@/lib/sample-data";
import { distancePresets } from "@/lib/distance";
import {
  useFeedPrefs,
  setFeedPrefs,
  useMyProfile,
  useDistanceUnit,
  DEFAULT_FILTERS,
  type DistanceUnitPref,
  type FeedMineFilter,
  type FeedMoneyFilter,
} from "@/lib/user-prefs-store";
import { markSportChoice } from "@/lib/default-sports";
import {
  applyView,
  filterSnapshot,
  makeViewId,
  suggestViewName,
  viewIsEdited,
} from "@/lib/feed-views";

/** Small pill group used for mutually exclusive choices. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-full border border-border bg-surface p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`flex-1 rounded-full px-3 py-2 text-xs font-bold transition-colors ${
              active ? "bg-lime text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Saved views ("My views"): a snapshot of the narrowing + ordering filters the
 * user can jump back to. Rendered both inside the sheet and above the feed.
 */
export function FeedViewsRow({ compact = false }: { compact?: boolean }) {
  const prefs = useFeedPrefs();
  const unit = useDistanceUnit();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const edited = viewIsEdited(prefs);

  if (compact && prefs.savedViews.length === 0) return null;

  const saveCurrent = () => {
    const trimmed = name.trim() || suggestViewName(filterSnapshot(prefs), unit);
    const view = {
      id: makeViewId(),
      name: trimmed.slice(0, 40),
      filters: filterSnapshot(prefs),
      createdAt: new Date().toISOString(),
    };
    setFeedPrefs({
      ...prefs,
      savedViews: [...prefs.savedViews, view].slice(-12),
      activeViewId: view.id,
    });
    setNaming(false);
    setName("");
  };

  const updateActive = () => {
    setFeedPrefs({
      ...prefs,
      savedViews: prefs.savedViews.map((v) =>
        v.id === prefs.activeViewId ? { ...v, filters: filterSnapshot(prefs) } : v,
      ),
    });
  };

  const remove = (id: string) => {
    setFeedPrefs({
      ...prefs,
      savedViews: prefs.savedViews.filter((v) => v.id !== id),
      activeViewId: prefs.activeViewId === id ? null : prefs.activeViewId,
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {prefs.savedViews.map((v) => {
          const active = prefs.activeViewId === v.id;
          return (
            <span
              key={v.id}
              className={`group inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                active ? "border-lime bg-lime text-primary-foreground" : "border-border bg-surface"
              }`}
            >
              <button
                onClick={() => setFeedPrefs(applyView(prefs, v))}
                className="inline-flex items-center gap-1"
              >
                <Bookmark className="h-3.5 w-3.5" />
                {v.name}
              </button>
              {!compact && (
                <button
                  onClick={() => remove(v.id)}
                  aria-label={`Delete view ${v.name}`}
                  className="opacity-60 hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </span>
          );
        })}

        {!compact &&
          (naming ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-lime bg-surface px-2 py-1">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveCurrent();
                  if (e.key === "Escape") setNaming(false);
                }}
                placeholder={suggestViewName(filterSnapshot(prefs), unit)}
                maxLength={40}
                className="w-40 bg-transparent px-1 text-xs outline-none"
              />
              <button onClick={saveCurrent} aria-label="Save view" className="text-lime">
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={() => setNaming(false)}
                aria-label="Cancel"
                className="text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </span>
          ) : (
            <button
              onClick={() => setNaming(true)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-surface px-3 py-1.5 text-xs font-semibold text-muted-foreground"
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              Save current
            </button>
          ))}
      </div>

      {!compact && edited && (
        <button onClick={updateActive} className="text-xs font-bold text-lime">
          Update saved view with current filters
        </button>
      )}
    </div>
  );
}

/**
 * Feed preferences sheet body, grouped so it's obvious what narrows results
 * (Narrow results), what reorders them (Order), and what only changes the
 * layout (Feed layout).
 */
export function FeedPreferencesBody() {
  const prefs = useFeedPrefs();
  const profile = useMyProfile();
  const hasCity = Boolean(profile?.city?.trim());
  const unit = useDistanceUnit();
  const presets = distancePresets(unit);
  const sections = prefs.sections;

  /** Any filter edit drops the "unchanged saved view" link unless it matches again. */
  const patch = (p: Partial<typeof prefs>) => setFeedPrefs({ ...prefs, ...p });

  const toggleSport = (s: Sport) => {
    markSportChoice("feed");
    return patch({
      preferredSports: prefs.preferredSports.includes(s)
        ? prefs.preferredSports.filter((x) => x !== s)
        : [...prefs.preferredSports, s],
    });
  };

  const toggleSection = (k: keyof typeof sections) => {
    const next = { ...sections, [k]: !sections[k] };
    if (!next.showForYou && !next.showUrgent) return; // never hide everything
    patch({ sections: next });
  };

  return (
    <>
      <FilterSection label="My views">
        <FeedViewsRow />
      </FilterSection>

      <FilterSection label="Narrow results · Sports">
        <div className="flex flex-wrap gap-2">
          {SPORTS.map((s) => {
            const active = prefs.preferredSports.includes(s.name);
            return (
              <button
                key={s.name}
                onClick={() => toggleSport(s.name)}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  active
                    ? "border-lime bg-lime text-primary-foreground"
                    : "border-border bg-surface"
                }`}
              >
                <span>{s.emoji}</span>
                {s.name}
              </button>
            );
          })}
        </div>
        {prefs.preferredSports.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">Showing every sport.</p>
        )}
      </FilterSection>

      <FilterSection
        label={
          <span className="flex items-center justify-between">
            <span>
              Narrow results · Distance
              {hasCity && profile?.city ? (
                <span className="ml-2 normal-case tracking-normal text-muted-foreground/80">
                  · {profile.city}
                </span>
              ) : null}
            </span>
            <span className="inline-flex rounded-full border border-border bg-surface p-0.5">
              {(["auto", "mi", "km"] as const).map((u) => (
                <button
                  key={u}
                  onClick={() => patch({ distanceUnit: u as DistanceUnitPref })}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    prefs.distanceUnit === u
                      ? "bg-lime text-primary-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {u === "auto" ? `Auto (${unit})` : u}
                </button>
              ))}
            </span>
          </span>
        }
      >
        {!hasCity && (
          <p className="mb-2 text-xs text-muted-foreground">
            <Link to="/profile/edit" className="font-semibold text-lime">
              Set your city
            </Link>{" "}
            to filter by distance.
          </p>
        )}
        <div className={`flex flex-wrap gap-2 ${hasCity ? "" : "pointer-events-none opacity-50"}`}>
          <button
            onClick={() => patch({ maxDistanceMi: null })}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
              prefs.maxDistanceMi == null
                ? "border-lime bg-lime text-primary-foreground"
                : "border-border bg-surface"
            }`}
          >
            Any
          </button>
          {presets.map(({ mi, label }) => {
            const active = prefs.maxDistanceMi != null && Math.abs(prefs.maxDistanceMi - mi) < 0.01;
            return (
              <button
                key={label}
                onClick={() => patch({ maxDistanceMi: mi })}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  active
                    ? "border-lime bg-lime text-primary-foreground"
                    : "border-border bg-surface"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </FilterSection>

      <FilterSection label="Narrow results · Price">
        <Segmented<FeedMoneyFilter>
          value={prefs.moneyFilter}
          onChange={(v) => patch({ moneyFilter: v })}
          options={[
            { value: "all", label: "All games" },
            { value: "free", label: "Free only" },
            { value: "paid", label: "Paid only" },
          ]}
        />
      </FilterSection>

      <FilterSection label="Narrow results · My games">
        <Segmented<FeedMineFilter>
          value={prefs.mineFilter}
          onChange={(v) => patch({ mineFilter: v })}
          options={[
            { value: "all", label: "Everyone's" },
            { value: "hosting", label: "I host" },
            { value: "joined", label: "I joined" },
          ]}
        />
      </FilterSection>

      <SortSection
        value={prefs.sortBy}
        onChange={(v) => patch({ sortBy: v })}
        options={[
          { value: "nearest" as const, label: "Nearest first" },
          { value: "soonest" as const, label: "Soonest first" },
        ]}
      />

      <FilterSection label="Feed layout">
        <p className="mb-2 text-xs text-muted-foreground">
          These only change what the feed shows — they never filter games out.
        </p>
        <div className="space-y-2">
          {(
            [
              ["showUrgent", "Needs players now"],
              ["showForYou", '"For you" list'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => toggleSection(k)}
              className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-semibold"
            >
              <span>{label}</span>
              <span
                className={`h-6 w-10 rounded-full p-0.5 transition-colors ${sections[k] ? "bg-lime" : "bg-secondary"}`}
              >
                <span
                  className={`block h-5 w-5 rounded-full bg-background transition-transform ${sections[k] ? "translate-x-4" : ""}`}
                />
              </span>
            </button>
          ))}
        </div>
      </FilterSection>

      <button
        onClick={() => setFeedPrefs({ ...prefs, ...DEFAULT_FILTERS, activeViewId: null })}
        className="mt-2 w-full rounded-full border border-border bg-surface px-4 py-2.5 text-xs font-bold text-coral"
      >
        Clear all filters
      </button>
    </>
  );
}

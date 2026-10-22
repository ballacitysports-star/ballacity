import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, Trophy } from "lucide-react";
import { OrgCard } from "@/components/OrgCard";
import { OrgDirectoryCard, type OrgDirectoryRow } from "@/components/org/OrgDirectoryCard";
import { EmptyState } from "@/components/ui/empty-state";
import { useAllOrgs } from "@/lib/org-store";
import { matchesOrgQuery } from "@/lib/org-search";
import { matchesSportList } from "@/lib/sport-filter";
import { listTrainerOrgs } from "@/lib/trainer-orgs.functions";
import { listUpcomingTryouts } from "@/lib/tryouts.functions";
import { DISCOVER_CATEGORIES, type DiscoverCategory } from "@/lib/discover-categories";

/** Top-level pills on /feed: one Discover surface for every pillar. */
export function DiscoverCategoryPills({
  value,
  onChange,
}: {
  value: DiscoverCategory;
  onChange: (c: DiscoverCategory) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Discover category"
      className="-mx-4 mb-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide"
    >
      {DISCOVER_CATEGORIES.map((c) => {
        const on = value === c.id;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(c.id)}
            className={`inline-flex min-h-11 shrink-0 snap-start items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
              on
                ? "border-lime bg-lime text-primary-foreground"
                : "border-border bg-surface text-muted-foreground hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const GROUP_LIMIT = 5;

/**
 * Teams, gyms and trainers in the Discover feed. With `cat="all"` (used while
 * searching) it renders grouped top matches with a "See all" per group;
 * otherwise the full list for one category. Pickup runs stay in the feed.
 */
export function DiscoverResults({
  cat,
  q,
  sports,
  onSeeAll,
}: {
  cat: Exclude<DiscoverCategory, "runs">;
  q: string;
  sports: readonly string[];
  onSeeAll?: (c: DiscoverCategory) => void;
}) {
  const grouped = cat === "all";
  const orgs = useAllOrgs();
  const teams = useMemo(
    () =>
      orgs
        .filter((o) => o.kind === "team")
        .filter((o) => matchesSportList(o.sports, sports as string[]))
        .filter((o) => matchesOrgQuery(o, q)),
    [orgs, sports, q],
  );
  const trainers = useMemo(
    () =>
      orgs
        .filter((o) => o.kind === "coach")
        .filter((o) => matchesSportList(o.sports, sports as string[]))
        .filter((o) => matchesOrgQuery(o, q)),
    [orgs, sports, q],
  );

  const gymQ = useDebounced(q.trim(), 250);
  const gymsQuery = useQuery({
    queryKey: ["discover-gyms", gymQ],
    queryFn: () => listTrainerOrgs({ data: { q: gymQ || undefined } }),
    enabled: grouped || cat === "gyms",
    staleTime: 60_000,
  });
  const gyms = useMemo(
    () => (gymsQuery.data ?? []) as unknown as OrgDirectoryRow[],
    [gymsQuery.data],
  );

  const fetchTryouts = useServerFn(listUpcomingTryouts);
  const tryoutsQuery = useQuery({
    queryKey: ["tryouts", "upcoming"],
    queryFn: () => fetchTryouts(),
    enabled: cat === "teams",
    staleTime: 60_000,
  });
  const tryouts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (tryoutsQuery.data ?? [])
      .filter((t) => matchesSportList(t.sports, sports as string[]))
      .filter((t) =>
        needle
          ? `${t.title} ${t.teamName} ${t.location ?? ""}`.toLowerCase().includes(needle)
          : true,
      );
  }, [tryoutsQuery.data, q, sports]);

  const [now] = useState(() => new Date());
  const take = <T,>(rows: T[]) => (grouped ? rows.slice(0, GROUP_LIMIT) : rows);

  const sections: {
    id: Exclude<DiscoverCategory, "all" | "runs">;
    title: string;
    count: number;
    body: React.ReactNode;
  }[] = [];

  if (grouped || cat === "teams") {
    sections.push({
      id: "teams",
      title: "Teams",
      count: teams.length,
      body: (
        <div className="grid gap-3 sm:grid-cols-2">
          {take(teams).map((o, i) => (
            <OrgCard key={o.id} org={o} index={i} />
          ))}
        </div>
      ),
    });
  }
  if (grouped || cat === "gyms") {
    sections.push({
      id: "gyms",
      title: "Venues",
      count: gyms.length,
      body: (
        <ul className="grid gap-3 sm:grid-cols-2">
          {take(gyms).map((o) => (
            <OrgDirectoryCard key={o.id} org={o} now={now} />
          ))}
        </ul>
      ),
    });
  }
  if (grouped || cat === "trainers") {
    sections.push({
      id: "trainers",
      title: "Trainers",
      count: trainers.length,
      body: (
        <div className="grid gap-3 sm:grid-cols-2">
          {take(trainers).map((o, i) => (
            <OrgCard key={o.id} org={o} index={i} />
          ))}
        </div>
      ),
    });
  }

  const visible = grouped ? sections.filter((s) => s.count > 0) : sections;

  return (
    <div className="space-y-6">
      {cat === "teams" && tryouts.length > 0 && (
        <section>
          <h2 className="section-eyebrow mb-2 flex items-center gap-1.5 text-muted-foreground">
            <Trophy className="h-4 w-4" /> Upcoming tryouts &amp; camps
          </h2>
          <ul className="space-y-2">
            {tryouts.map((t) => (
              <li key={t.id}>
                <Link
                  to="/tryouts/$postId"
                  params={{ postId: t.id }}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-surface p-3 hover:border-lime/40"
                >
                  <div className="min-w-0">
                    <div className="truncate font-display text-sm font-bold">{t.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {t.teamName}
                      {t.location ? ` · ${t.location}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold capitalize text-amber-500">
                    {t.kind === "clinic" ? "Camp" : "Tryout"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {visible.map((s) => (
        <section key={s.id} aria-label={s.title}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="section-eyebrow text-muted-foreground">
              {s.title} <span className="font-normal">({s.count})</span>
            </h2>
            {grouped && onSeeAll && s.count > GROUP_LIMIT && (
              <button
                type="button"
                onClick={() => onSeeAll(s.id)}
                className="text-xs font-semibold text-lime"
              >
                See all
              </button>
            )}
          </div>
          {s.count === 0 && !(s.id === "gyms" && gymsQuery.isLoading) ? (
            <EmptyState
              icon={<Search className="h-6 w-6" aria-hidden />}
              title={
                q.trim()
                  ? `No ${s.title.toLowerCase()} match "${q.trim()}"`
                  : `No ${s.title.toLowerCase()} yet`
              }
              description="Try a shorter search, or a different sport or city name."
            />
          ) : (
            s.body
          )}
        </section>
      ))}
    </div>
  );
}

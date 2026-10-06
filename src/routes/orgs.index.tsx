import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Building2, Plus, Search } from "lucide-react";
import { listTrainerOrgs } from "@/lib/trainer-orgs.functions";
import { OrgDirectoryCard, type OrgDirectoryRow } from "@/components/org/OrgDirectoryCard";
import { OrgFilterPills } from "@/components/org/OrgFilterPills";
import { applyDirectoryFilters, type DirectoryFilterId } from "@/lib/org-directory-filters";

export const Route = createFileRoute("/orgs/")({
  head: () =>
    pageHead({
      path: "/orgs",
      title: "Gyms & courts — ballaCity",
      description:
        "Browse gyms, courts, and sports complexes on ballaCity. See photos, live hours, amenities, and book a court.",
    }),
  component: OrgsIndex,
});

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function OrgsIndex() {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<DirectoryFilterId>>(new Set());
  const q = useDebounced(text.trim(), 250);

  // Re-evaluate "open now" as the clock moves.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["orgs-index", q],
    queryFn: () => listTrainerOrgs({ data: { q: q || undefined } }),
  });

  const all = useMemo(() => (data ?? []) as unknown as OrgDirectoryRow[], [data]);
  const rows = useMemo(() => applyDirectoryFilters(all, selected, now), [all, selected, now]);
  const filtered = !!q || selected.size > 0;

  const toggle = (id: DirectoryFilterId) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const clearAll = () => {
    setSelected(new Set());
    setText("");
  };

  return (
    <div className="page-shell-content pt-4 pb-40 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Gyms &amp; courts.</h1>
          <p className="mt-1 page-subtitle">
            See the courts, check live hours, and book a spot to play.
          </p>
        </div>
        <Link
          to="/orgs/create"
          className="inline-flex items-center gap-1.5 rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground glow-lime"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} /> Create gym
        </Link>
      </header>

      <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search by name, city or address"
          aria-label="Search facilities"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <OrgFilterPills
        selected={selected}
        onToggle={toggle}
        onClear={() => setSelected(new Set())}
      />

      {isLoading ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="h-72 animate-pulse rounded-2xl border border-border bg-surface"
            />
          ))}
        </ul>
      ) : isError ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t load facilities.{" "}
          <button type="button" onClick={() => refetch()} className="font-semibold text-lime">
            Try again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-muted-foreground">
          <div className="inline-flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4 text-lime" />{" "}
            {filtered ? "No facilities match those filters." : "No gyms yet."}
          </div>
          <div className="mt-3">
            {filtered ? (
              <button type="button" onClick={clearAll} className="text-lime font-semibold">
                Clear filters
              </button>
            ) : (
              <Link to="/orgs/create" className="text-lime font-semibold hover:underline">
                Create the first one →
              </Link>
            )}
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {rows.length} {rows.length === 1 ? "facility" : "facilities"}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((o) => (
              <OrgDirectoryCard key={o.id} org={o} now={now} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

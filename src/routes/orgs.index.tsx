import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Building2, MapPin, Plus, Search } from "lucide-react";
import { listTrainerOrgs } from "@/lib/trainer-orgs.functions";
import { OrgDirectoryCard, type OrgDirectoryRow } from "@/components/org/OrgDirectoryCard";
import { ORG_CATEGORIES } from "@/lib/org-listing";
import { parseHours, resolveOpenState } from "@/lib/org-hours";

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
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const debouncedName = useDebounced(name, 250);
  const debouncedCity = useDebounced(city, 250);

  // Re-evaluate "open now" as the clock moves.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["orgs-index", debouncedName, debouncedCity, category],
    queryFn: () =>
      listTrainerOrgs({
        data: {
          search: debouncedName || undefined,
          city: debouncedCity || undefined,
          category: category || undefined,
        },
      }),
  });

  const all = useMemo(() => (data ?? []) as unknown as OrgDirectoryRow[], [data]);
  const rows = useMemo(
    () =>
      openOnly
        ? all.filter(
            (o) => resolveOpenState(parseHours(o.hours), o.timezone, now).status === "open",
          )
        : all,
    [all, openOnly, now],
  );
  const filtered = !!(debouncedName || debouncedCity || category || openOnly);

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

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Search by name"
            aria-label="Search facilities by name"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City or address"
            aria-label="Filter facilities by city or address"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={openOnly}
          onClick={() => setOpenOnly((v) => !v)}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
            openOnly
              ? "border border-lime/40 bg-lime/15 text-lime"
              : "border border-border text-muted-foreground"
          }`}
        >
          Open now
        </button>
        {["", ...ORG_CATEGORIES].map((c) => (
          <button
            key={c || "all"}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              category === c
                ? "border border-lime/40 bg-lime/15 text-lime"
                : "border border-border text-muted-foreground"
            }`}
          >
            {c || "All"}
          </button>
        ))}
      </div>

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
          {!filtered && (
            <div className="mt-3">
              <Link to="/orgs/create" className="text-lime font-semibold hover:underline">
                Create the first one →
              </Link>
            </div>
          )}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((o) => (
            <OrgDirectoryCard key={o.id} org={o} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

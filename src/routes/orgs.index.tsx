import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Building2, Plus, Search, ShieldCheck } from "lucide-react";
import { listTrainerOrgs } from "@/lib/trainer-orgs.functions";

export const Route = createFileRoute("/orgs/")({
  head: () =>
    pageHead({
      path: "/orgs",
      title: "Gyms & training organizations — ballaCity",
      description:
        "Browse gyms, courts, and training organizations on ballaCity. See hours, amenities, and member reviews.",
    }),
  component: OrgsIndex,
});

function OrgsIndex() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["orgs-index", q],
    queryFn: () => listTrainerOrgs({ data: { search: q || undefined } }),
  });
  const rows = data ?? [];

  return (
    <div className="page-shell-content pt-4 pb-40 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Gyms.</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Training organizations and gyms with rosters of trainers.
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
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search gyms by name"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-muted-foreground">
          <div className="inline-flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4 text-lime" /> No gyms yet.
          </div>
          <div className="mt-3">
            <Link to="/orgs/create" className="text-lime font-semibold hover:underline">
              Create the first one →
            </Link>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((o) => (
            <li key={o.id}>
              <Link
                to="/orgs/$orgId"
                params={{ orgId: o.id }}
                className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 transition-colors hover:border-lime/40"
              >
                <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border bg-lime-gradient font-display text-base font-bold text-primary-foreground">
                  {(o as { avatar_url?: string | null }).avatar_url ? (
                    <img
                      src={(o as { avatar_url: string }).avatar_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : o.avatar && (o.avatar.startsWith("http") || o.avatar.startsWith("/")) ? (
                    <img src={o.avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    (o.avatar || o.name.slice(0, 2)).toUpperCase().slice(0, 3)
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-display text-base font-bold">{o.name}</span>
                    {o.verified && (
                      <ShieldCheck className="h-3.5 w-3.5 text-lime" aria-label="Verified" />
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    @{o.handle}
                    {o.city ? <> · {o.city}</> : null}
                  </div>
                  {o.bio && (
                    <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/80">
                      {o.bio}
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

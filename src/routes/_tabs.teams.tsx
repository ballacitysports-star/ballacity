import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, Plus, Megaphone, Users, GraduationCap } from "lucide-react";
import { type OrgKind } from "@/lib/sample-data";
import { useAllOrgs } from "@/lib/org-store";
import { OrgCard } from "@/components/OrgCard";

export const Route = createFileRoute("/_tabs/teams")({
  head: () => ({ meta: [{ title: "Teams & Coaches — OpenRun" }] }),
  component: TeamsPage,
});

const KIND_META: Record<
  OrgKind,
  {
    label: string;
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    emptyText: string;
    icon: typeof Users;
    featuredBadge: string;
  }
> = {
  team: {
    label: "Teams",
    title: "Teams & clubs.",
    subtitle: "Follow squads, find tryouts, join open runs.",
    searchPlaceholder: "Search teams, sport, city",
    emptyText: "No teams match.",
    icon: Users,
    featuredBadge: "Hiring · 3 spots",
  },
  coach: {
    label: "Coaches",
    title: "Coaches & trainers.",
    subtitle: "Book sessions, join clinics, level up your game.",
    searchPlaceholder: "Search coaches, sport, credential",
    emptyText: "No coaches match.",
    icon: GraduationCap,
    featuredBadge: "Booking · clinics open",
  },
};

function TeamsPage() {
  const [kind, setKind] = useState<OrgKind>("team");
  const [q, setQ] = useState("");
  const orgs = useAllOrgs();
  const meta = KIND_META[kind];

  const list = useMemo(
    () =>
      orgs
        .filter((o) => o.kind === kind)
        .filter((o) =>
          q
            ? (o.name + o.handle + o.tagline + o.sports.join(" "))
                .toLowerCase()
                .includes(q.toLowerCase())
            : true,
        ),
    [orgs, kind, q],
  );

  const featured =
    orgs.find((o) => o.verified && o.kind === kind) ?? orgs.find((o) => o.kind === kind);

  return (
    <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 pt-6">
      <motion.div
        key={kind + "-header"}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4"
      >
        <h1 className="font-display text-3xl font-bold leading-tight">{meta.title}</h1>
        <p className="text-muted-foreground text-sm">{meta.subtitle}</p>
      </motion.div>

      {/* Kind segmented control — primary split */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border border-border bg-surface p-1">
        {(["team", "coach"] as OrgKind[]).map((k) => {
          const m = KIND_META[k];
          const Icon = m.icon;
          const active = kind === k;
          return (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`relative flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                active ? "bg-lime text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={2.5} />
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Featured banner */}
      {featured && (
        <motion.div
          key={kind + "-featured"}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative mb-5 overflow-hidden rounded-3xl border border-lime/30 bg-surface"
        >
          <img src={featured.cover} alt="" className="h-32 w-full object-cover opacity-50" />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
          <div className="absolute inset-0 p-4 flex flex-col justify-end">
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime uppercase tracking-wider">
              <Megaphone className="h-3 w-3" /> {meta.featuredBadge}
            </span>
            <div className="mt-1 font-display text-xl font-bold">
              {featured.name} · {kind === "team" ? "Open Tryouts" : "Now Booking"}
            </div>
            <div className="text-xs text-muted-foreground">{featured.tagline}</div>
          </div>
        </motion.div>
      )}

      {/* Search */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={meta.searchPlaceholder}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Link
          to="/teams/create"
          className="grid h-11 w-11 place-items-center rounded-full bg-lime-gradient text-primary-foreground glow-lime"
          aria-label={kind === "team" ? "Create team" : "Create coach profile"}
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </Link>
      </div>

      <div className="space-y-3 pb-6">
        {list.map((o, i) => (
          <OrgCard key={o.id} org={o} index={i} />
        ))}
        {list.length === 0 && (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center text-muted-foreground">
            {meta.emptyText}
          </div>
        )}
      </div>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, Plus, Megaphone } from "lucide-react";
import { ORGS, type OrgKind } from "@/lib/sample-data";
import { OrgCard } from "@/components/OrgCard";

export const Route = createFileRoute("/_tabs/teams")({
  head: () => ({ meta: [{ title: "Teams & Coaches — OpenRun" }] }),
  component: TeamsPage,
});

const TABS: { key: OrgKind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "team", label: "Teams" },
  { key: "coach", label: "Coaches" },
];

function TeamsPage() {
  const [kind, setKind] = useState<OrgKind | "all">("all");
  const [q, setQ] = useState("");

  const list = useMemo(
    () =>
      ORGS.filter((o) => (kind === "all" ? true : o.kind === kind)).filter((o) =>
        q ? (o.name + o.handle + o.tagline + o.sports.join(" ")).toLowerCase().includes(q.toLowerCase()) : true,
      ),
    [kind, q],
  );

  const featured = ORGS.find((o) => o.verified && o.kind === "team")!;

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
        <h1 className="font-display text-3xl font-bold leading-tight">Teams & coaches.</h1>
        <p className="text-muted-foreground text-sm">Follow squads, find tryouts, book coaching near you.</p>
      </motion.div>

      {/* Featured banner */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative mb-5 overflow-hidden rounded-3xl border border-lime/30 bg-surface"
      >
        <img src={featured.cover} alt="" className="h-32 w-full object-cover opacity-50" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
        <div className="absolute inset-0 p-4 flex flex-col justify-end">
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime uppercase tracking-wider">
            <Megaphone className="h-3 w-3" /> Hiring · 3 spots
          </span>
          <div className="mt-1 font-display text-xl font-bold">{featured.name} · Open Tryouts</div>
          <div className="text-xs text-muted-foreground">{featured.tagline}</div>
        </div>
      </motion.div>

      {/* Search */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search teams, coaches, sport"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button className="grid h-11 w-11 place-items-center rounded-full bg-lime-gradient text-primary-foreground glow-lime" aria-label="Create org">
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>

      {/* Kind tabs */}
      <div className="mb-4 inline-flex rounded-full border border-border bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setKind(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-all ${
              kind === t.key ? "bg-lime text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-3 pb-6">
        {list.map((o, i) => <OrgCard key={o.id} org={o} index={i} />)}
        {list.length === 0 && (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center text-muted-foreground">
            No teams or coaches match.
          </div>
        )}
      </div>
    </div>
  );
}

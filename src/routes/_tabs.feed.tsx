import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, Bell } from "lucide-react";
import { Logo } from "@/components/Logo";
import { SportChips } from "@/components/SportChips";
import { GameCard } from "@/components/GameCard";
import { GAMES, type Sport } from "@/lib/sample-data";
import { motion } from "framer-motion";

export const Route = createFileRoute("/_tabs/feed")({
  head: () => ({ meta: [{ title: "Feed — OpenRun" }] }),
  component: Feed,
});

function Feed() {
  const [sport, setSport] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return GAMES.filter((g) => (sport ? g.sport === sport : true))
      .filter((g) =>
        q
          ? (g.title + g.location + g.host.name).toLowerCase().includes(q.toLowerCase())
          : true,
      )
      .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  }, [sport, q]);

  const urgent = filtered.filter((g) => g.urgent);

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <div className="flex items-center justify-between mb-5">
        <Logo />
        <button className="relative grid h-10 w-10 place-items-center rounded-full border border-border bg-surface">
          <Bell className="h-5 w-5" />
          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-coral" />
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4"
      >
        <h1 className="font-display text-3xl font-bold leading-tight">Tonight's run.</h1>
        <p className="text-muted-foreground text-sm">8 pickup games happening near East Village.</p>
      </motion.div>

      <div className="flex gap-2 mb-4">
        <div className="flex-1 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search games, courts, players"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button className="grid h-11 w-11 place-items-center rounded-full border border-border bg-surface">
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-5">
        <SportChips selected={sport} onSelect={setSport} />
      </div>

      {urgent.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-coral">
              ⚡ Needs players now
            </h2>
            <span className="text-xs text-muted-foreground">{urgent.length} games</span>
          </div>
          <div className="space-y-3">
            {urgent.map((g, i) => <GameCard key={g.id} game={g} index={i} />)}
          </div>
        </div>
      )}

      <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
        For you
      </h2>
      <div className="space-y-3">
        {filtered.map((g, i) => <GameCard key={g.id} game={g} index={i} />)}
        {filtered.length === 0 && (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center text-muted-foreground">
            No games match yet. Try clearing filters.
          </div>
        )}
      </div>
    </div>
  );
}
